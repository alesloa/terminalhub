import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../db/store.js";
import type { CatalogEntry, CatalogSource, InstalledSkill, Scope, SkillInstall, UpdateStatus } from "./types.js";
import { skillsDir, disabledDir, assertSafe, sanitizeFolderName, scopeOf } from "./paths.js";
import { parseFrontmatter } from "./frontmatter.js";
import { discoverSkills, type SkillCandidate } from "./discover.js";
import { computeFolderHash } from "./hash.js";
import { normalizeSource, cloneShallow, remoteHead, type NormalizedSource } from "./git.js";
import { isOfficialSource } from "./trust.js";
import { searchRegistry, type RegistrySkill } from "./registry.js";

export interface ScanResult {
  tmpId: string;
  candidates: SkillCandidate[];
}

export interface SkillsController {
  /** Skills on disk for a scope (active + disabled), enriched with provenance from the DB. */
  list(scope: Scope, workspaceFolder?: string): Promise<InstalledSkill[]>;
  /** Raw SKILL.md text for one installed skill. */
  read(installPath: string, workspaceFolder?: string): Promise<string>;
  /** Clone/open a source and list the skills inside it (phase 1 of install). */
  scan(source: string): Promise<ScanResult>;
  /** Copy the picked skills from a prior scan into a scope (phase 2). */
  install(tmpId: string, names: string[], scope: Scope, workspaceFolder?: string): Promise<InstalledSkill[]>;
  /** Delete a skill folder + its provenance row. */
  remove(installPath: string, workspaceFolder?: string): Promise<void>;
  /** Move a skill between skills/ and skills-disabled/. Returns its new path. */
  setEnabled(installPath: string, enabled: boolean, workspaceFolder?: string): Promise<{ installPath: string }>;
  /** ls-remote pre-filter + folder-hash compare to flag outdated skills in a scope. */
  checkUpdates(scope: Scope, workspaceFolder?: string): Promise<UpdateStatus[]>;
  /** Re-clone a skill's source and overwrite it with the latest content. */
  update(installPath: string, workspaceFolder?: string): Promise<InstalledSkill>;
  /** Search the skills.sh registry. */
  search(query: string): Promise<RegistrySkill[]>;
  /** Configured catalog sources with their index status. */
  catalogSources(): CatalogSource[];
  /** Add a source and index it; returns the updated source list. `official` defaults to whether the
   *  source owner is a known vendor org, and is freely overridable afterward. */
  addCatalogSource(source: string, official?: boolean): Promise<CatalogSource[]>;
  /** Flip a source's Official flag (drives the ✓ badge on its skills); returns the source list. */
  setCatalogSourceOfficial(source: string, official: boolean): Promise<CatalogSource[]>;
  /** Drop a source and its indexed entries; returns the updated source list. */
  removeCatalogSource(source: string): Promise<CatalogSource[]>;
  /** Re-scan every source for SKILL.md folders, rebuilding the local index. */
  reindexCatalog(): Promise<CatalogSource[]>;
  /** Indexed catalog entries, optionally filtered by name/description. */
  listCatalog(filter?: string): CatalogEntry[];
}

interface ScanEntry {
  dir: string; // root the candidates' relPaths are resolved against
  source: NormalizedSource;
  candidates: SkillCandidate[];
  cleanup: () => Promise<void>;
}

export function createSkillsController(store: Store): SkillsController {
  const scans = new Map<string, ScanEntry>();
  let scanSeq = 0;

  /** Repo-relative path of a candidate's folder, accounting for a /tree/ subpath. */
  function skillPathOf(source: NormalizedSource, relPath: string): string {
    return source.subPath ? path.posix.join(source.subPath, relPath === "." ? "" : relPath) : relPath;
  }

  /** Copy a skill folder into place (dropping any .git) and return its content hash. Shared by
   *  install and update so both record a hash computed the same way. */
  async function writeSkillFolder(src: string, dest: string): Promise<string> {
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(src, dest, { recursive: true, filter: (p) => !p.split(path.sep).includes(".git") });
    return computeFolderHash(dest);
  }

  /** Installed-with-provenance rows whose folder lives in the given scope's dirs. */
  function rowsInScope(scope: Scope, ws?: string): SkillInstall[] {
    const roots = [skillsDir(scope, ws), disabledDir(scope, ws)];
    return store.listSkillInstalls().filter((r) => roots.some((root) => r.installPath.startsWith(root + path.sep)));
  }

  /** Resolve a source to a local dir (clone for remotes, use-in-place for local), with cleanup.
   *  Shared by interactive scan and catalog indexing. */
  async function openSource(source: string): Promise<{ dir: string; source: NormalizedSource; cleanup: () => Promise<void> }> {
    const ns = normalizeSource(source);
    if (ns.isLocal) {
      const dir = ns.subPath ? path.join(ns.cloneUrl, ns.subPath) : ns.cloneUrl;
      return { dir, source: ns, cleanup: async () => {} };
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skclone-"));
    const repoDir = path.join(tmp, "repo");
    await cloneShallow(ns.cloneUrl, repoDir, ns.ref);
    const dir = ns.subPath ? path.join(repoDir, ns.subPath) : repoDir;
    return { dir, source: ns, cleanup: async () => { await fs.rm(tmp, { recursive: true, force: true }); } };
  }

  /** Re-scan one source and rebuild its catalog entries. Records an error meta on failure
   *  (and clears the source's stale entries) instead of throwing, so a bad source can't sink
   *  a whole reindex. */
  async function indexOne(source: string): Promise<void> {
    try {
      const opened = await openSource(source);
      try {
        const candidates = await discoverSkills(opened.dir);
        store.replaceCatalogEntries(source, candidates.map((c) => ({
          name: c.name, description: c.description, relPath: c.relPath,
        })));
        store.setCatalogSourceMeta(source, { lastIndexedAt: Date.now(), skillCount: candidates.length, error: null });
      } finally {
        await opened.cleanup();
      }
    } catch (e) {
      store.replaceCatalogEntries(source, []);
      store.setCatalogSourceMeta(source, {
        lastIndexedAt: Date.now(), skillCount: 0, error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function listDir(dir: string, scope: Scope, enabled: boolean): Promise<InstalledSkill[]> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return []; // dir doesn't exist yet → no skills
    }
    const out: InstalledSkill[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const installPath = path.join(dir, e.name);
      let content: string;
      try {
        content = await fs.readFile(path.join(installPath, "SKILL.md"), "utf8");
      } catch {
        continue; // not a skill folder
      }
      const fm = parseFrontmatter(content);
      const row = store.getSkillInstall(installPath);
      out.push({
        installPath,
        name: e.name,
        displayName: fm.name ?? e.name,
        description: fm.description,
        scope,
        enabled,
        sourceType: row?.sourceType ?? null,
        sourceUrl: row?.sourceUrl ?? null,
        updateAvailable: null,
      });
    }
    return out;
  }

  return {
    async list(scope, ws) {
      return [
        ...(await listDir(skillsDir(scope, ws), scope, true)),
        ...(await listDir(disabledDir(scope, ws), scope, false)),
      ];
    },

    async read(installPath, ws) {
      const safe = assertSafe(installPath, ws);
      return fs.readFile(path.join(safe, "SKILL.md"), "utf8");
    },

    async scan(source) {
      const { dir, source: ns, cleanup } = await openSource(source);
      const candidates = await discoverSkills(dir);
      const tmpId = `scan_${++scanSeq}`;
      scans.set(tmpId, { dir, source: ns, candidates, cleanup });
      return { tmpId, candidates };
    },

    async install(tmpId, names, scope, ws) {
      const entry = scans.get(tmpId);
      if (!entry) throw new Error("scan expired — re-scan the source");
      const targetDir = skillsDir(scope, ws);
      await fs.mkdir(targetDir, { recursive: true });
      const head = await remoteHead(entry.source.cloneUrl); // null for a non-git local folder
      const now = Date.now();
      const installed: InstalledSkill[] = [];

      try {
        for (const cand of entry.candidates) {
          if (!names.includes(cand.name)) continue;
          const folder = sanitizeFolderName(cand.name);
          const installPath = path.join(targetDir, folder);
          const row: SkillInstall = {
            installPath,
            name: folder,
            scope,
            sourceType: entry.source.sourceType,
            sourceUrl: entry.source.cloneUrl,
            skillPath: skillPathOf(entry.source, cand.relPath),
            repoHeadHash: head,
            folderHash: await writeSkillFolder(path.join(entry.dir, cand.relPath), installPath),
            installedAt: now,
            updatedAt: now,
          };
          store.upsertSkillInstall(row);
          installed.push({
            installPath, name: folder, displayName: cand.name, description: cand.description,
            scope, enabled: true, sourceType: row.sourceType, sourceUrl: row.sourceUrl, updateAvailable: null,
          });
        }
      } finally {
        await entry.cleanup();
        scans.delete(tmpId);
      }
      return installed;
    },

    async remove(installPath, ws) {
      const safe = assertSafe(installPath, ws);
      await fs.rm(safe, { recursive: true, force: true });
      store.deleteSkillInstall(safe);
    },

    async setEnabled(installPath, enabled, ws) {
      const safe = assertSafe(installPath, ws);
      const scope = scopeOf(safe, ws);
      const targetDir = enabled ? skillsDir(scope, ws) : disabledDir(scope, ws);
      const newPath = path.join(targetDir, path.basename(safe));
      if (newPath === safe) return { installPath: safe };
      await fs.mkdir(targetDir, { recursive: true });
      await fs.rename(safe, newPath);
      store.moveSkillInstall(safe, newPath);
      return { installPath: newPath };
    },

    async checkUpdates(scope, ws) {
      // Group the scope's provenance rows by source repo so each repo is cloned at most once.
      const byUrl = new Map<string, SkillInstall[]>();
      for (const r of rowsInScope(scope, ws)) {
        if (!r.sourceUrl) continue;
        byUrl.set(r.sourceUrl, [...(byUrl.get(r.sourceUrl) ?? []), r]);
      }

      // Cheap pre-filter: ls-remote every distinct repo concurrently.
      const heads = new Map(
        await Promise.all([...byUrl.keys()].map(async (url) => [url, await remoteHead(url)] as const)),
      );

      const result: UpdateStatus[] = [];
      for (const [url, group] of byUrl) {
        const head = heads.get(url) ?? null;
        if (!head) {
          for (const r of group) result.push({ installPath: r.installPath, updateAvailable: null });
          continue;
        }
        if (group.every((r) => r.repoHeadHash && r.repoHeadHash === head)) {
          for (const r of group) result.push({ installPath: r.installPath, updateAvailable: false }); // HEAD unchanged → no clone
          continue;
        }
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skupd-"));
        try {
          const repoDir = path.join(tmp, "repo");
          await cloneShallow(url, repoDir);
          for (const r of group) {
            try {
              const fresh = await computeFolderHash(path.join(repoDir, r.skillPath ?? "."));
              result.push({ installPath: r.installPath, updateAvailable: r.folderHash ? fresh !== r.folderHash : null });
            } catch {
              result.push({ installPath: r.installPath, updateAvailable: null });
            }
          }
        } catch {
          for (const r of group) result.push({ installPath: r.installPath, updateAvailable: null });
        } finally {
          await fs.rm(tmp, { recursive: true, force: true });
        }
      }
      return result;
    },

    async update(installPath, ws) {
      const safe = assertSafe(installPath, ws);
      const row = store.getSkillInstall(safe);
      if (!row?.sourceUrl) throw new Error("this skill has no recorded source to update from");
      const scope = scopeOf(safe, ws);
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skupd-"));
      try {
        const repoDir = path.join(tmp, "repo");
        await cloneShallow(row.sourceUrl, repoDir, undefined);
        const folderHash = await writeSkillFolder(path.join(repoDir, row.skillPath ?? "."), safe);
        store.upsertSkillInstall({
          ...row,
          repoHeadHash: await remoteHead(row.sourceUrl),
          folderHash,
          updatedAt: Date.now(),
        });
        const fm = parseFrontmatter(await fs.readFile(path.join(safe, "SKILL.md"), "utf8").catch(() => ""));
        return {
          installPath: safe, name: row.name, displayName: fm.name ?? row.name, description: fm.description,
          scope, enabled: safe.startsWith(skillsDir(scope, ws) + path.sep),
          sourceType: row.sourceType, sourceUrl: row.sourceUrl, updateAvailable: false,
        };
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    },

    search(query) {
      return searchRegistry(query);
    },

    catalogSources() {
      return store.listCatalogSources();
    },

    async addCatalogSource(source, official) {
      const trimmed = source.trim();
      if (!trimmed) throw new Error("catalog source cannot be empty");
      // Seed the Official flag from the vendor allowlist (anthropics/openai/… → on) as a default the
      // user can flip; an explicit flag from the caller wins.
      store.addCatalogSource(trimmed, official ?? isOfficialSource(trimmed));
      await indexOne(trimmed); // index immediately so the new source shows up without a manual reindex
      return store.listCatalogSources();
    },

    async setCatalogSourceOfficial(source, official) {
      store.setCatalogSourceOfficial(source.trim(), official);
      return store.listCatalogSources();
    },

    async removeCatalogSource(source) {
      store.removeCatalogSource(source.trim());
      return store.listCatalogSources();
    },

    async reindexCatalog() {
      for (const s of store.listCatalogSources()) await indexOne(s.source);
      return store.listCatalogSources();
    },

    listCatalog(filter) {
      const official = new Map(store.listCatalogSources().map((s) => [s.source, s.official]));
      return store.listCatalogEntries(filter).map((e) => ({ ...e, official: official.get(e.source) ?? false }));
    },
  };
}
