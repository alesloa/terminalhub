import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "./store.js";
import type { SkillInstall } from "../skills/types.js";
import { DEFAULT_GUI_CONFIG, type GuiConfig } from "../gui/config.js";

const skillRow = (over: Partial<SkillInstall> = {}): SkillInstall => ({
  installPath: "/ws/.claude/skills/foo",
  name: "foo",
  scope: "workspace",
  sourceType: "github",
  sourceUrl: "https://github.com/o/r",
  skillPath: "skills/foo",
  repoHeadHash: "abc",
  folderHash: "hash1",
  installedAt: 1,
  updatedAt: 1,
  ...over,
});

let store: Store;
beforeEach(() => { store = createStore(":memory:"); });

describe("store: workspaces", () => {
  it("creates and reads a workspace", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "claude", color: null });
    expect(ws.id).toMatch(/^ws_/);
    expect(store.getWorkspace(ws.id)?.name).toBe("A");
    expect(store.listWorkspaces()).toHaveLength(2); // the migration's Desktop card + the one just created
  });
  it("updates position and name", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    store.updateWorkspace(ws.id, { x: 10, y: 20, name: "B" });
    const got = store.getWorkspace(ws.id)!;
    expect(got.x).toBe(10); expect(got.y).toBe(20); expect(got.name).toBe("B");
  });
  it("defaults layout to null and round-trips a layout JSON blob verbatim", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    expect(store.getWorkspace(ws.id)?.layout).toBeNull();
    const layout = JSON.stringify({ sidebarWidth: 320, terminalListWidth: 180, dockHeight: 420, leftOpen: false, rightOpen: true, activeView: "scm" });
    store.updateWorkspace(ws.id, { layout });
    expect(store.getWorkspace(ws.id)?.layout).toBe(layout); // opaque: byte-for-byte what we stored
    store.updateWorkspace(ws.id, { layout: null });          // clearing is allowed
    expect(store.getWorkspace(ws.id)?.layout).toBeNull();
  });
  it("cascades terminal delete when workspace deleted", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    store.createTerminal({ workspaceId: ws.id, title: "T1", color: null, tmuxSession: "tr_x_y", launchCommandOverride: null });
    store.deleteWorkspace(ws.id);
    expect(store.listTerminals(ws.id)).toHaveLength(0);
  });
});

describe("store: workspace color memory (survives delete, keyed by folder)", () => {
  it("restores a remembered color when re-creating the same folder without one", () => {
    const a = store.createWorkspace({ name: "A", folder: "/tmp/proj", launchCommand: "", color: "#ff0000" });
    store.deleteWorkspace(a.id);
    const b = store.createWorkspace({ name: "A2", folder: "/tmp/proj", launchCommand: "", color: null });
    expect(b.color).toBe("#ff0000");
    expect(store.getWorkspace(b.id)?.color).toBe("#ff0000");
  });
  it("remembers a color set later via updateWorkspace", () => {
    const a = store.createWorkspace({ name: "A", folder: "/tmp/proj", launchCommand: "", color: null });
    store.updateWorkspace(a.id, { color: "#00ff00" });
    store.deleteWorkspace(a.id);
    const b = store.createWorkspace({ name: "A2", folder: "/tmp/proj", launchCommand: "", color: null });
    expect(b.color).toBe("#00ff00");
  });
  it("an explicit color on re-create wins over the remembered one", () => {
    const a = store.createWorkspace({ name: "A", folder: "/tmp/proj", launchCommand: "", color: "#ff0000" });
    store.deleteWorkspace(a.id);
    const b = store.createWorkspace({ name: "A2", folder: "/tmp/proj", launchCommand: "", color: "#0000ff" });
    expect(b.color).toBe("#0000ff");
  });
  it("clearing the color (Default) forgets it, so re-create has no color", () => {
    const a = store.createWorkspace({ name: "A", folder: "/tmp/proj", launchCommand: "", color: "#ff0000" });
    store.updateWorkspace(a.id, { color: null });
    store.deleteWorkspace(a.id);
    const b = store.createWorkspace({ name: "A2", folder: "/tmp/proj", launchCommand: "", color: null });
    expect(b.color).toBeNull();
  });
  it("memory is per-folder, not shared across folders", () => {
    const a = store.createWorkspace({ name: "A", folder: "/tmp/one", launchCommand: "", color: "#ff0000" });
    store.deleteWorkspace(a.id);
    const b = store.createWorkspace({ name: "B", folder: "/tmp/two", launchCommand: "", color: null });
    expect(b.color).toBeNull();
  });
});

describe("store: terminals", () => {
  it("creates, lists, updates, deletes a terminal", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    const t = store.createTerminal({ workspaceId: ws.id, title: "T1", color: null, tmuxSession: "tr_a_b", launchCommandOverride: null });
    expect(t.id).toMatch(/^tm_/);
    store.updateTerminal(t.id, { title: "renamed", color: "#f00" });
    expect(store.getTerminal(t.id)?.title).toBe("renamed");
    store.deleteTerminal(t.id);
    expect(store.getTerminal(t.id)).toBeUndefined();
  });

  it("defaults icon to null and round-trips an icon set + clear", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    const t = store.createTerminal({ workspaceId: ws.id, title: "T1", color: null, tmuxSession: "tr_a_b", launchCommandOverride: null });
    expect(t.icon).toBeNull();
    store.updateTerminal(t.id, { icon: "flame" });
    expect(store.getTerminal(t.id)?.icon).toBe("flame");
    store.updateTerminal(t.id, { icon: null });
    expect(store.getTerminal(t.id)?.icon).toBeNull();
  });

  it("starts auto-titled, stays auto on an auto update, and a user rename pins it", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    const t = store.createTerminal({ workspaceId: ws.id, title: "Terminal 1", color: null, tmuxSession: "tr_a_b", launchCommandOverride: null });
    expect(t.titleAuto).toBe(true);
    // An auto-titler update keeps the tab unlocked so it can still be refined.
    store.updateTerminal(t.id, { title: "Claude - fix the bug", auto: true });
    expect(store.getTerminal(t.id)).toMatchObject({ title: "Claude - fix the bug", titleAuto: true });
    // A user rename (no auto) pins the name.
    store.updateTerminal(t.id, { title: "my tab" });
    expect(store.getTerminal(t.id)).toMatchObject({ title: "my tab", titleAuto: false });
    // A later auto update still changes the title in the store but the lock stays off — the web gate
    // (titleAuto) is what stops the auto-titler from calling this once a tab is pinned.
    store.updateTerminal(t.id, { color: "#f00" });
    expect(store.getTerminal(t.id)?.titleAuto).toBe(false);
  });
});

describe("store: claude session prefs", () => {
  it("returns {} when nothing is set", () => {
    expect(store.getClaudePrefs()).toEqual({});
  });
  it("upserts a pin and a color, reading them back", () => {
    store.setClaudePref("sess-1", { pinned: true });
    store.setClaudePref("sess-1", { color: "#ff0000" });
    expect(store.getClaudePrefs()["sess-1"]).toEqual({ pinned: true, color: "#ff0000" });
  });
  it("only updates the fields present in the patch", () => {
    store.setClaudePref("sess-2", { pinned: true, color: "#0f0" });
    store.setClaudePref("sess-2", { pinned: false }); // color must survive
    expect(store.getClaudePrefs()["sess-2"]).toEqual({ pinned: false, color: "#0f0" });
  });
  it("clearing a color to null persists null", () => {
    store.setClaudePref("sess-3", { color: "#abc" });
    store.setClaudePref("sess-3", { color: null });
    expect(store.getClaudePrefs()["sess-3"]).toEqual({ pinned: false, color: null });
  });
  it("a fresh row with only a color defaults pinned to false", () => {
    store.setClaudePref("sess-4", { color: "#123" });
    expect(store.getClaudePrefs()["sess-4"]).toEqual({ pinned: false, color: "#123" });
  });
  it("deletes a pref row", () => {
    store.setClaudePref("sess-5", { pinned: true });
    store.deleteClaudePref("sess-5");
    expect(store.getClaudePrefs()["sess-5"]).toBeUndefined();
  });
});

describe("store: bookmarks (keyed by folder, survive workspace delete)", () => {
  it("creates a bookmark with a bk_ id and reads it back in the folder list", () => {
    const b = store.createBookmark({ folder: "/tmp/proj", filePath: "/tmp/proj/a.ts", line: 12, label: null, preview: "const x = 1" });
    expect(b.id).toMatch(/^bk_/);
    expect(b.line).toBe(12);
    const list = store.listBookmarks("/tmp/proj");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filePath: "/tmp/proj/a.ts", line: 12, label: null, preview: "const x = 1" });
  });

  it("lists ordered by filePath then line", () => {
    store.createBookmark({ folder: "/p", filePath: "/p/b.ts", line: 3, label: null, preview: null });
    store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 9, label: null, preview: null });
    store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 2, label: null, preview: null });
    expect(store.listBookmarks("/p").map(b => [b.filePath, b.line])).toEqual([
      ["/p/a.ts", 2], ["/p/a.ts", 9], ["/p/b.ts", 3],
    ]);
  });

  it("scopes bookmarks per folder", () => {
    store.createBookmark({ folder: "/one", filePath: "/one/a.ts", line: 1, label: null, preview: null });
    store.createBookmark({ folder: "/two", filePath: "/two/b.ts", line: 1, label: null, preview: null });
    expect(store.listBookmarks("/one")).toHaveLength(1);
    expect(store.listBookmarks("/two")).toHaveLength(1);
  });

  it("survives deleting the workspace that shares its folder (no cascade)", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp/proj", launchCommand: "", color: null });
    store.createBookmark({ folder: "/tmp/proj", filePath: "/tmp/proj/a.ts", line: 5, label: null, preview: null });
    store.deleteWorkspace(ws.id);
    expect(store.listBookmarks("/tmp/proj")).toHaveLength(1);
  });

  it("updates a label", () => {
    const b = store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 4, label: null, preview: null });
    store.updateBookmark(b.id, { label: "TODO here" });
    expect(store.getBookmark(b.id)?.label).toBe("TODO here");
  });

  it("clears a label back to null", () => {
    const b = store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 4, label: "x", preview: null });
    store.updateBookmark(b.id, { label: null });
    expect(store.getBookmark(b.id)?.label).toBeNull();
  });

  it("updates a line (sticky reconcile)", () => {
    const b = store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 4, label: null, preview: null });
    store.updateBookmarkLine(b.id, 40);
    expect(store.getBookmark(b.id)?.line).toBe(40);
  });

  it("deletes a single bookmark", () => {
    const b = store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 4, label: null, preview: null });
    store.deleteBookmark(b.id);
    expect(store.getBookmark(b.id)).toBeUndefined();
  });

  it("clears all bookmarks for one file only", () => {
    store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 1, label: null, preview: null });
    store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 9, label: null, preview: null });
    store.createBookmark({ folder: "/p", filePath: "/p/b.ts", line: 1, label: null, preview: null });
    store.clearFileBookmarks("/p", "/p/a.ts");
    expect(store.listBookmarks("/p").map(b => b.filePath)).toEqual(["/p/b.ts"]);
  });

  it("clears all bookmarks for a folder", () => {
    store.createBookmark({ folder: "/p", filePath: "/p/a.ts", line: 1, label: null, preview: null });
    store.createBookmark({ folder: "/p", filePath: "/p/b.ts", line: 1, label: null, preview: null });
    store.clearFolderBookmarks("/p");
    expect(store.listBookmarks("/p")).toHaveLength(0);
  });
});

describe("store: skill installs (provenance, keyed by absolute path)", () => {
  it("returns [] when nothing is installed", () => {
    expect(store.listSkillInstalls()).toEqual([]);
  });
  it("upserts a row and reads it back by path", () => {
    store.upsertSkillInstall(skillRow());
    expect(store.getSkillInstall("/ws/.claude/skills/foo")).toMatchObject({
      name: "foo", scope: "workspace", sourceUrl: "https://github.com/o/r", folderHash: "hash1",
    });
    expect(store.listSkillInstalls()).toHaveLength(1);
  });
  it("upsert on the same path replaces the row (re-install / update)", () => {
    store.upsertSkillInstall(skillRow());
    store.upsertSkillInstall(skillRow({ folderHash: "hash2", repoHeadHash: "def", updatedAt: 2 }));
    expect(store.listSkillInstalls()).toHaveLength(1);
    expect(store.getSkillInstall("/ws/.claude/skills/foo")).toMatchObject({ folderHash: "hash2", repoHeadHash: "def", updatedAt: 2 });
  });
  it("move rekeys the row's path, preserving provenance", () => {
    store.upsertSkillInstall(skillRow());
    store.moveSkillInstall("/ws/.claude/skills/foo", "/ws/.claude/skills-disabled/foo");
    expect(store.getSkillInstall("/ws/.claude/skills/foo")).toBeUndefined();
    expect(store.getSkillInstall("/ws/.claude/skills-disabled/foo")).toMatchObject({
      installPath: "/ws/.claude/skills-disabled/foo", name: "foo", sourceUrl: "https://github.com/o/r",
    });
  });
  it("move is a no-op when the source path has no row", () => {
    expect(() => store.moveSkillInstall("/nope", "/also-nope")).not.toThrow();
    expect(store.listSkillInstalls()).toEqual([]);
  });
  it("deletes a row by path", () => {
    store.upsertSkillInstall(skillRow());
    store.deleteSkillInstall("/ws/.claude/skills/foo");
    expect(store.getSkillInstall("/ws/.claude/skills/foo")).toBeUndefined();
  });
});

describe("store: skill catalog (sources + index)", () => {
  it("adds sources idempotently and lists them", () => {
    store.addCatalogSource("owner/repo");
    store.addCatalogSource("owner/repo"); // duplicate ignored
    store.addCatalogSource("other/repo");
    expect(store.listCatalogSources().map((s) => s.source)).toEqual(["owner/repo", "other/repo"]);
    expect(store.listCatalogSources()[0]).toMatchObject({ skillCount: 0, lastIndexedAt: null, error: null });
  });

  it("replaces a source's entries wholesale and records meta", () => {
    store.addCatalogSource("owner/repo");
    store.replaceCatalogEntries("owner/repo", [
      { name: "alpha", description: "first", relPath: "alpha" },
      { name: "beta", description: null, relPath: "nested/beta" },
    ]);
    store.setCatalogSourceMeta("owner/repo", { lastIndexedAt: 99, skillCount: 2, error: null });
    expect(store.listCatalogEntries().map((e) => e.name)).toEqual(["alpha", "beta"]);
    expect(store.listCatalogSources()[0]).toMatchObject({ skillCount: 2, lastIndexedAt: 99 });

    // Re-index replaces, doesn't append.
    store.replaceCatalogEntries("owner/repo", [{ name: "alpha", description: "kept", relPath: "alpha" }]);
    expect(store.listCatalogEntries().map((e) => e.name)).toEqual(["alpha"]);
  });

  it("filters entries by name or description, case-insensitive", () => {
    store.addCatalogSource("o/r");
    store.replaceCatalogEntries("o/r", [
      { name: "react-helper", description: "UI stuff", relPath: "a" },
      { name: "db-tool", description: "Postgres queries", relPath: "b" },
    ]);
    expect(store.listCatalogEntries("REACT").map((e) => e.name)).toEqual(["react-helper"]);
    expect(store.listCatalogEntries("postgres").map((e) => e.name)).toEqual(["db-tool"]);
  });

  it("removing a source drops its entries too", () => {
    store.addCatalogSource("o/r");
    store.replaceCatalogEntries("o/r", [{ name: "x", description: null, relPath: "x" }]);
    store.removeCatalogSource("o/r");
    expect(store.listCatalogSources()).toEqual([]);
    expect(store.listCatalogEntries()).toEqual([]);
  });
});

describe("store: better comments config", () => {
  it("returns the Better Comments defaults when unset", () => {
    const c = store.getBetterComments();
    expect(c.enabled).toBe(true);
    expect(c.tags.map((t) => t.tag)).toEqual(["!", "?", "//", "todo", "*"]);
    expect(c.tags.find((t) => t.tag === "!")?.color).toBe("#FF2D00");
    expect(c.tags.find((t) => t.tag === "//")?.strikethrough).toBe(true);
  });
  it("persists a custom config and round-trips it as JSON", () => {
    store.setBetterComments({
      enabled: false,
      tags: [{ tag: "fixme", color: "#abcdef", bold: true, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" }],
    });
    const c = store.getBetterComments();
    expect(c.enabled).toBe(false);
    expect(c.tags).toHaveLength(1);
    expect(c.tags[0]).toMatchObject({ tag: "fixme", color: "#abcdef", bold: true });
  });
  it("falls back to defaults when the stored blob is corrupt", () => {
    // mimic a bad row by writing through the generic settings path
    store.setSettings({ betterComments: "{not json" } as any);
    expect(store.getBetterComments().tags.map((t) => t.tag)).toEqual(["!", "?", "//", "todo", "*"]);
  });
  it("does not leak the betterComments blob into getSettings()", () => {
    store.setBetterComments({ enabled: true, tags: [] });
    expect(store.getSettings()).not.toHaveProperty("betterComments");
  });
});

describe("store: breaks config", () => {
  it("returns the break defaults when unset (disabled, 60/10 min)", () => {
    const b = store.getBreaks();
    expect(b).toEqual({
      enabled: false, intervalMinutes: 60, durationMinutes: 10,
      pauseWhenHidden: true, preWarnSeconds: 20, allowSkip: true, speak: false,
    });
  });
  it("persists a custom config and round-trips it as JSON", () => {
    store.setBreaks({ enabled: true, intervalMinutes: 90, durationMinutes: 15, pauseWhenHidden: false, preWarnSeconds: 30, allowSkip: false, speak: true });
    expect(store.getBreaks()).toMatchObject({ enabled: true, intervalMinutes: 90, durationMinutes: 15, allowSkip: false, speak: true });
  });
  it("falls back to defaults when the stored blob is corrupt", () => {
    store.setSettings({ breaks: "{not json" } as any);
    expect(store.getBreaks().intervalMinutes).toBe(60);
  });
  it("does not leak the breaks blob into getSettings()", () => {
    store.setBreaks({ enabled: true, intervalMinutes: 60, durationMinutes: 10, pauseWhenHidden: true, preWarnSeconds: 20, allowSkip: true, speak: false });
    expect(store.getSettings()).not.toHaveProperty("breaks");
  });
});

describe("store: settings", () => {
  it("returns defaults then persists overrides", () => {
    expect(store.getSettings().defaultLaunchCommand).toBe("claude");
    store.setSettings({ defaultLaunchCommand: "codex" });
    expect(store.getSettings().defaultLaunchCommand).toBe("codex");
  });
  it("persists editor settings with their runtime types", () => {
    store.setSettings({
      autoSave: true,
      autoSaveDelaySeconds: 5,
      minimap: false,
      wordWrap: true,
      lineNumbers: false,
      diffSplit: false,
      sidebarPosition: "top",
    });
    expect(store.getSettings()).toMatchObject({
      autoSave: true,
      autoSaveDelaySeconds: 5,
      minimap: false,
      wordWrap: true,
      lineNumbers: false,
      diffSplit: false,
      sidebarPosition: "top",
    });
  });
});

describe("store: favorites — groups & items", () => {
  it("creates root and nested groups", () => {
    const work = store.createFavoriteGroup({ parentId: null, name: "Work" });
    expect(work.id).toMatch(/^fg_/);
    expect(work.parentId).toBeNull();
    const fe = store.createFavoriteGroup({ parentId: work.id, name: "Frontend" });
    expect(fe.parentId).toBe(work.id);
    expect(store.listFavoriteGroups()).toHaveLength(2);
    expect(store.getFavoriteGroup(work.id)?.name).toBe("Work");
  });

  it("assigns contiguous positions to sibling groups", () => {
    const a = store.createFavoriteGroup({ parentId: null, name: "A" });
    const b = store.createFavoriteGroup({ parentId: null, name: "B" });
    const c = store.createFavoriteGroup({ parentId: null, name: "C" });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
  });

  it("creates favorites at root and inside a group", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "Work" });
    const root = store.createFavorite({ groupId: null, folder: "/tmp/scratch" });
    const inG = store.createFavorite({ groupId: g.id, folder: "/tmp/proj", label: "Proj" });
    expect(root!.id).toMatch(/^fv_/);
    expect(root!.groupId).toBeNull();
    expect(root!.label).toBeNull();
    expect(inG!.groupId).toBe(g.id);
    expect(inG!.label).toBe("Proj");
    expect(store.listFavorites()).toHaveLength(2);
  });

  it("dedups a favorite by folder within a bucket, allows it across buckets", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "Work" });
    const first = store.createFavorite({ groupId: g.id, folder: "/tmp/proj" });
    const dup = store.createFavorite({ groupId: g.id, folder: "/tmp/proj" });
    expect(first).toBeDefined();
    expect(dup).toBeUndefined();
    expect(store.listFavorites()).toHaveLength(1);
    const atRoot = store.createFavorite({ groupId: null, folder: "/tmp/proj" });
    expect(atRoot).toBeDefined();
    expect(store.listFavorites()).toHaveLength(2);
  });

  it("renames a group and a favorite label", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "Work" });
    const f = store.createFavorite({ groupId: g.id, folder: "/tmp/proj", label: null });
    store.renameFavoriteGroup(g.id, "Job");
    store.renameFavorite(f!.id, "My Project");
    expect(store.getFavoriteGroup(g.id)?.name).toBe("Job");
    expect(store.getFavorite(f!.id)?.label).toBe("My Project");
  });
});

describe("store: favorites — move & delete", () => {
  const rootFavs = () =>
    store.listFavorites().filter(f => f.groupId === null).sort((a, b) => a.position - b.position);

  it("moveFavorite reorders within a bucket and renumbers", () => {
    const a = store.createFavorite({ groupId: null, folder: "/a" })!;
    store.createFavorite({ groupId: null, folder: "/b" });
    const c = store.createFavorite({ groupId: null, folder: "/c" })!;
    store.moveFavorite(c.id, null, 0);
    expect(rootFavs().map(f => f.folder)).toEqual(["/c", "/a", "/b"]);
    expect(rootFavs().map(f => f.position)).toEqual([0, 1, 2]);
    expect(a.id).toBeDefined();
  });

  it("moveFavorite reparents into a group and renumbers the source bucket", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "G" });
    const a = store.createFavorite({ groupId: null, folder: "/a" })!;
    store.createFavorite({ groupId: null, folder: "/b" });
    store.moveFavorite(a.id, g.id, 0);
    expect(store.getFavorite(a.id)!.groupId).toBe(g.id);
    expect(store.getFavorite(a.id)!.position).toBe(0);
    expect(rootFavs().map(f => f.folder)).toEqual(["/b"]);
    expect(rootFavs()[0].position).toBe(0);
  });

  it("moveFavorite is a no-op when the destination bucket already has that folder", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "G" });
    const a = store.createFavorite({ groupId: null, folder: "/dup" })!;
    store.createFavorite({ groupId: g.id, folder: "/dup" });
    store.moveFavorite(a.id, g.id, 0);
    expect(store.getFavorite(a.id)!.groupId).toBeNull();
  });

  it("moveFavoriteGroup reparents and returns true", () => {
    const a = store.createFavoriteGroup({ parentId: null, name: "A" });
    const b = store.createFavoriteGroup({ parentId: null, name: "B" });
    expect(store.moveFavoriteGroup(b.id, a.id, 0)).toBe(true);
    expect(store.getFavoriteGroup(b.id)!.parentId).toBe(a.id);
  });

  it("moveFavoriteGroup rejects moving a group into itself or a descendant", () => {
    const a = store.createFavoriteGroup({ parentId: null, name: "A" });
    const child = store.createFavoriteGroup({ parentId: a.id, name: "Child" });
    expect(store.moveFavoriteGroup(a.id, a.id, 0)).toBe(false);
    expect(store.moveFavoriteGroup(a.id, child.id, 0)).toBe(false);
    expect(store.getFavoriteGroup(a.id)!.parentId).toBeNull();
  });

  it("deleteFavorite removes it and renumbers the bucket", () => {
    store.createFavorite({ groupId: null, folder: "/a" });
    const b = store.createFavorite({ groupId: null, folder: "/b" })!;
    store.createFavorite({ groupId: null, folder: "/c" });
    store.deleteFavorite(b.id);
    expect(rootFavs().map(f => f.folder)).toEqual(["/a", "/c"]);
    expect(rootFavs().map(f => f.position)).toEqual([0, 1]);
  });

  it("deleteFavoriteGroup cascades: removes the subtree groups and their favorites", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "G" });
    const sub = store.createFavoriteGroup({ parentId: g.id, name: "Sub" });
    store.createFavorite({ groupId: g.id, folder: "/in-g" });
    store.createFavorite({ groupId: sub.id, folder: "/in-sub" });
    store.createFavorite({ groupId: null, folder: "/root" });
    store.deleteFavoriteGroup(g.id);
    expect(store.getFavoriteGroup(g.id)).toBeUndefined();
    expect(store.getFavoriteGroup(sub.id)).toBeUndefined();
    expect(store.listFavoriteGroups()).toHaveLength(0);
    expect(store.listFavorites().map(f => f.folder)).toEqual(["/root"]);
  });

  it("deleteFavoriteGroup reassigns direct favorites to a target group, deletes the subtree", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "G" });
    const dst = store.createFavoriteGroup({ parentId: null, name: "Dst" });
    const sub = store.createFavoriteGroup({ parentId: g.id, name: "Sub" });
    const f1 = store.createFavorite({ groupId: g.id, folder: "/in-g" })!;
    store.createFavorite({ groupId: sub.id, folder: "/in-sub" });
    store.deleteFavoriteGroup(g.id, dst.id);
    expect(store.getFavoriteGroup(g.id)).toBeUndefined();
    expect(store.getFavoriteGroup(sub.id)).toBeUndefined();
    expect(store.getFavorite(f1.id)!.groupId).toBe(dst.id);
    expect(store.listFavorites().filter(f => f.groupId === dst.id).map(f => f.folder)).toEqual(["/in-g"]);
    expect(store.listFavorites().some(f => f.folder === "/in-sub")).toBe(false);
  });

  it("deleteFavoriteGroup reassign to root (null) moves direct favorites to root", () => {
    const g = store.createFavoriteGroup({ parentId: null, name: "G" });
    const f1 = store.createFavorite({ groupId: g.id, folder: "/in-g" })!;
    store.deleteFavoriteGroup(g.id, null);
    expect(store.getFavorite(f1.id)!.groupId).toBeNull();
  });
});

describe("store: blueprints", () => {
  const graph = JSON.stringify({ nodes: [{ id: "n1", type: "start" }], edges: [] });

  it("creates and reads a blueprint, storing the graph verbatim", () => {
    const bp = store.createBlueprint({ name: "Hello World", graph });
    expect(bp.id).toMatch(/^bp_/);
    const got = store.getBlueprint(bp.id)!;
    expect(got.name).toBe("Hello World");
    expect(got.graph).toBe(graph); // opaque: byte-for-byte what we stored
    expect(got.createdAt).toBe(got.updatedAt);
  });

  it("lists blueprints most-recently-updated first", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const a = store.createBlueprint({ name: "A", graph });
      vi.setSystemTime(2_000);
      const b = store.createBlueprint({ name: "B", graph });
      vi.setSystemTime(3_000);
      store.updateBlueprint(a.id, { name: "A2" }); // bumps updatedAt → A floats to the top
      expect(store.listBlueprints().map(x => x.id)).toEqual([a.id, b.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates name and graph and bumps updatedAt", () => {
    const bp = store.createBlueprint({ name: "A", graph });
    const next = JSON.stringify({ nodes: [], edges: [] });
    store.updateBlueprint(bp.id, { name: "B", graph: next });
    const got = store.getBlueprint(bp.id)!;
    expect(got.name).toBe("B");
    expect(got.graph).toBe(next);
    expect(got.updatedAt).toBeGreaterThanOrEqual(got.createdAt);
  });

  it("deletes a blueprint", () => {
    const bp = store.createBlueprint({ name: "A", graph });
    store.deleteBlueprint(bp.id);
    expect(store.getBlueprint(bp.id)).toBeUndefined();
    expect(store.listBlueprints()).toHaveLength(0);
  });
});

describe("store: drive accounts (server-only tokens, public projection)", () => {
  it("upserts a drive account by email and lists it without tokens", () => {
    const a = store.upsertDriveAccount({
      email: "me@example.com", name: "Me", picture: null,
      refreshToken: "r1", accessToken: "a1", expiry: 123, scope: "drive",
    });
    expect(a.id).toMatch(/^da_/);

    // second upsert with the same email updates in place (no duplicate row)
    store.upsertDriveAccount({
      email: "me@example.com", name: "Me 2", picture: null,
      refreshToken: "r2", accessToken: "a2", expiry: 456, scope: "drive",
    });

    const list = store.listDriveAccounts();          // public shape only
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ id: a.id, email: "me@example.com", name: "Me 2", label: null, picture: null });
    expect((list[0] as any).refreshToken).toBeUndefined();

    const full = store.getDriveAccount(a.id)!;        // full row, server-only
    expect(full.refreshToken).toBe("r2");

    store.updateDriveTokens(a.id, { accessToken: "a3", expiry: 789 });
    expect(store.getDriveAccount(a.id)!.accessToken).toBe("a3");

    // rename → custom label in the public projection; blank → back to null (UI falls back to email)
    store.renameDriveAccount(a.id, "Work Drive");
    expect(store.listDriveAccounts()[0].label).toBe("Work Drive");
    store.renameDriveAccount(a.id, "   ");
    expect(store.listDriveAccounts()[0].label).toBeNull();

    store.deleteDriveAccount(a.id);
    expect(store.listDriveAccounts()).toHaveLength(0);
  });
});

describe("store: spaces boot migration", () => {
  it("a fresh DB gets a Home space and a Desktop catch-all card", () => {
    const s = createStore(":memory:");
    const spaces = s.listSpaces();
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe("Home");
    expect(spaces[0].position).toBe(0);

    const homeId = s.getHomeSpaceId();
    expect(homeId).toBe(spaces[0].id);

    const deskId = s.getDesktopWorkspaceId();
    expect(deskId).toBeDefined();
    const desk = s.getWorkspace(deskId!)!;
    expect(desk.name).toBe("Desktop");
    expect(desk.folder).toBe(homedir());
    expect(desk.spaceId).toBe(homeId);
    expect(s.listWorkspaces()).toHaveLength(1); // just the Desktop card
  });

  it("backfills NULL spaceId rows to Home and is idempotent across reopens", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-spaces-"));
    const dbPath = join(dir, "t.db");
    const s1 = createStore(dbPath);
    const homeId = s1.getHomeSpaceId();
    const deskId = s1.getDesktopWorkspaceId();
    s1.createWorkspace({ name: "Proj", folder: "/tmp/proj", launchCommand: "", color: null });

    // Simulate a pre-migration DB: null out every spaceId, then reopen so the migration re-runs.
    const raw = new Database(dbPath);
    raw.prepare(`UPDATE workspaces SET spaceId = NULL`).run();
    raw.close();

    const s2 = createStore(dbPath);
    // No duplicate Home / Desktop on the second boot.
    expect(s2.listSpaces()).toHaveLength(1);
    expect(s2.getHomeSpaceId()).toBe(homeId);
    expect(s2.getDesktopWorkspaceId()).toBe(deskId);
    // Every workspace was backfilled to Home.
    expect(s2.listWorkspaces().every(w => w.spaceId === homeId)).toBe(true);
  });

  it("createWorkspace defaults spaceId to Home when omitted", () => {
    const s = createStore(":memory:");
    const ws = s.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    expect(ws.spaceId).toBe(s.getHomeSpaceId());
  });

  it("folds a duplicate 'Home' space into the canonical one on reopen, keeping its cards", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-duphome-"));
    const dbPath = join(dir, "t.db");
    const s1 = createStore(dbPath);
    const homeId = s1.getHomeSpaceId()!;

    // Simulate an earlier build's artifact: a SECOND space literally named "Home" holding a card.
    const raw = new Database(dbPath);
    const dupId = "sp_dup0001";
    raw.prepare(`INSERT INTO spaces (id,name,icon,color,position,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)`)
      .run(dupId, "Home", null, null, 5, 1, 1);
    raw.prepare(`INSERT INTO workspaces (id,name,folder,launchCommand,color,cardColor,layout,spaceId,x,y,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run("ws_orphan01", "Orphan", "/tmp/orphan", "", null, null, null, dupId, 0, 0, 1, 1);
    raw.close();

    const s2 = createStore(dbPath);
    // Only the canonical Home survives; the duplicate shell is gone, positions stay contiguous.
    expect(s2.listSpaces()).toHaveLength(1);
    expect(s2.getHomeSpaceId()).toBe(homeId);
    expect(s2.getSpace(dupId)).toBeUndefined();
    expect(s2.listSpaces()[0].position).toBe(0);
    // The orphaned card was rehomed into the canonical Home, not lost.
    expect(s2.getWorkspace("ws_orphan01")!.spaceId).toBe(homeId);
  });
});

describe("store: spaces — CRUD, move, delete-reassign", () => {
  it("creates spaces with contiguous positions after Home", () => {
    const s = createStore(":memory:");
    const a = s.createSpace({ name: "Work" });
    const b = s.createSpace({ name: "Personal", icon: "home", color: "#abcdef" });
    expect(a.id).toMatch(/^sp_/);
    expect([a.position, b.position]).toEqual([1, 2]); // Home is 0
    expect(b.icon).toBe("home");
    expect(b.color).toBe("#abcdef");
    expect(s.listSpaces().map(x => x.name)).toEqual(["Home", "Work", "Personal"]);
  });

  it("updates a space's name, icon, and color", () => {
    const s = createStore(":memory:");
    const a = s.createSpace({ name: "Work" });
    s.updateSpace(a.id, { name: "Job", icon: "briefcase", color: "#112233" });
    const got = s.getSpace(a.id)!;
    expect(got.name).toBe("Job");
    expect(got.icon).toBe("briefcase");
    expect(got.color).toBe("#112233");
  });

  it("moveSpace reorders and renumbers contiguously", () => {
    const s = createStore(":memory:");
    const a = s.createSpace({ name: "A" }); // pos 1
    const b = s.createSpace({ name: "B" }); // pos 2
    s.moveSpace(b.id, 0); // B to the very front
    expect(s.listSpaces().map(x => x.name)).toEqual(["B", "Home", "A"]);
    expect(s.listSpaces().map(x => x.position)).toEqual([0, 1, 2]);
    expect(a.id).toBeDefined();
  });

  it("deleteSpace reassigns its workspaces to the previous space, then renumbers", () => {
    const s = createStore(":memory:");
    const a = s.createSpace({ name: "A" }); // pos 1
    const b = s.createSpace({ name: "B" }); // pos 2
    const w = s.createWorkspace({ name: "P", folder: "/tmp/p", launchCommand: "", color: null, spaceId: b.id });
    expect(s.deleteSpace(b.id)).toBe(true);
    expect(s.getSpace(b.id)).toBeUndefined();
    expect(s.getWorkspace(w.id)!.spaceId).toBe(a.id); // previous by position
    expect(s.listSpaces().map(x => x.position)).toEqual([0, 1]);
  });

  it("deleting the first non-home space reassigns to the next space", () => {
    const s = createStore(":memory:");
    const a = s.createSpace({ name: "A" }); // pos 1
    const b = s.createSpace({ name: "B" }); // pos 2
    s.moveSpace(a.id, 0); // A now pos 0, Home pos 1, B pos 2
    const w = s.createWorkspace({ name: "P", folder: "/tmp/p", launchCommand: "", color: null, spaceId: a.id });
    expect(s.deleteSpace(a.id)).toBe(true);
    expect(s.getWorkspace(w.id)!.spaceId).toBe(s.listSpaces()[0].id); // next space (now first)
  });

  it("refuses to delete the Home space or the last remaining space", () => {
    const s = createStore(":memory:");
    expect(s.deleteSpace(s.getHomeSpaceId()!)).toBe(false); // Home
    const a = s.createSpace({ name: "A" });
    expect(s.deleteSpace(a.id)).toBe(true);
    // Only Home remains now; deleting it is still refused (it is both home and last).
    expect(s.deleteSpace(s.getHomeSpaceId()!)).toBe(false);
    expect(s.listSpaces()).toHaveLength(1);
  });

  it("updateWorkspace sets spaceId; reassignTerminals re-points rows without touching tmuxSession", () => {
    const s = createStore(":memory:");
    const a = s.createSpace({ name: "A" });
    const w1 = s.createWorkspace({ name: "W1", folder: "/tmp/1", launchCommand: "", color: null });
    s.updateWorkspace(w1.id, { spaceId: a.id });
    expect(s.getWorkspace(w1.id)!.spaceId).toBe(a.id);

    const w2 = s.createWorkspace({ name: "W2", folder: "/tmp/2", launchCommand: "", color: null });
    const t = s.createTerminal({ workspaceId: w1.id, title: "T", color: null, tmuxSession: "tr_w1_t", launchCommandOverride: null });
    s.reassignTerminals(w1.id, w2.id);
    const moved = s.getTerminal(t.id)!;
    expect(moved.workspaceId).toBe(w2.id);
    expect(moved.tmuxSession).toBe("tr_w1_t"); // unchanged — session name is cosmetic
    expect(s.listTerminals(w1.id)).toHaveLength(0);
    expect(s.listTerminals(w2.id)).toHaveLength(1);
  });
});

describe("store: system prompts", () => {
  it("defaults a workspace systemPrompt to null and round-trips one", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    expect(store.getWorkspace(ws.id)!.systemPrompt).toBeNull();
    store.updateWorkspace(ws.id, { systemPrompt: { text: "Be terse.", includeGlobal: false } });
    expect(store.getWorkspace(ws.id)!.systemPrompt).toEqual({ text: "Be terse.", includeGlobal: false });
  });

  it("accepts a workspace systemPrompt at create time", () => {
    const ws = store.createWorkspace({
      name: "A", folder: "/tmp", launchCommand: "", color: null,
      systemPrompt: { text: "WS rule.", includeGlobal: true },
    });
    expect(store.getWorkspace(ws.id)!.systemPrompt).toEqual({ text: "WS rule.", includeGlobal: true });
  });

  it("defaults a terminal systemPrompt to null and round-trips one set at create", () => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    const plain = store.createTerminal({ workspaceId: ws.id, title: "T", color: null, tmuxSession: "s1", launchCommandOverride: null });
    expect(store.getTerminal(plain.id)!.systemPrompt).toBeNull();
    const withPrompt = store.createTerminal({
      workspaceId: ws.id, title: "T2", color: null, tmuxSession: "s2", launchCommandOverride: null,
      systemPrompt: { text: "Term rule.", includeParent: false },
    });
    expect(store.getTerminal(withPrompt.id)!.systemPrompt).toEqual({ text: "Term rule.", includeParent: false });
  });

  it("round-trips the per-agent global system prompts blob", () => {
    expect(store.getAgentSystemPrompts()).toEqual({});
    store.setAgentSystemPrompts({ claude: "You are Claude.", codex: "You are Codex." });
    expect(store.getAgentSystemPrompts()).toEqual({ claude: "You are Claude.", codex: "You are Codex." });
  });

  it("round-trips the removed-agents blob (defaults to empty)", () => {
    expect(store.getRemovedAgents()).toEqual([]);
    store.setRemovedAgents(["codex", "cursor"]);
    expect(store.getRemovedAgents()).toEqual(["codex", "cursor"]);
    // Non-string entries are dropped so a malformed blob can't poison the picker filter.
    store.setRemovedAgents(["claude"]);
    expect(store.getRemovedAgents()).toEqual(["claude"]);
  });
});

describe("store: youtube hidden / banned (persistent deletions)", () => {
  const mk = (over: Partial<{ videoId: string; title: string; channelTitle: string; thumbnail: string }> = {}) =>
    ({ videoId: "v1", title: "T", channelTitle: "C", thumbnail: "th", ...over });

  it("hides per-playlist; other playlists and bans are unaffected", () => {
    store.ytHide("PL1", mk());
    expect(store.ytHiddenForPlaylist("PL1").map((h) => h.videoId)).toEqual(["v1"]);
    expect(store.ytHiddenForPlaylist("PL2")).toEqual([]);
    expect(store.ytBans()).toEqual([]);
  });

  it("bans collapse any per-playlist rows for that video", () => {
    store.ytHide("PL1", mk());
    store.ytBan(mk());
    expect(store.ytHiddenForPlaylist("PL1")).toEqual([]); // collapsed into the ban
    expect(store.ytBans().map((b) => b.videoId)).toEqual(["v1"]);
  });

  it("restore and unban are scoped to their own row", () => {
    store.ytHide("PL1", mk({ videoId: "a" }));
    store.ytHide("PL2", mk({ videoId: "a" }));
    store.ytRestore("PL1", "a"); // only the PL1 row
    expect(store.ytHiddenForPlaylist("PL1")).toEqual([]);
    expect(store.ytHiddenForPlaylist("PL2").map((h) => h.videoId)).toEqual(["a"]);

    store.ytBan(mk({ videoId: "b" }));
    store.ytUnban("a"); // only removes a ('' scope) row — 'b' ban stays
    expect(store.ytBans().map((b) => b.videoId)).toEqual(["b"]);
  });

  it("re-hiding the same (video, playlist) upserts the snapshot, not a duplicate", () => {
    store.ytHide("PL1", mk({ title: "first" }));
    store.ytHide("PL1", mk({ title: "second" }));
    const rows = store.ytHiddenForPlaylist("PL1");
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("second");
  });

  it("survives a reopen (persisted to the db file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-ythidden-"));
    const dbPath = join(dir, "t.db");
    const s1 = createStore(dbPath);
    s1.ytHide("PL1", mk());
    s1.ytBan(mk({ videoId: "v2" }));
    const s2 = createStore(dbPath);
    expect(s2.ytHiddenForPlaylist("PL1").map((h) => h.videoId)).toEqual(["v1"]);
    expect(s2.ytBans().map((b) => b.videoId)).toEqual(["v2"]);
  });
});

describe("store: terminal GUI mode", () => {
  const SESSION_ID = "aaaabbbb-1111-2222-3333-444455556666";
  type TerminalOver = Partial<{ launchCommandOverride: string | null; mode: "tmux" | "gui"; agentSessionId: string | null }>;
  const mkTerminal = (over: TerminalOver = {}) => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    return store.createTerminal({ workspaceId: ws.id, title: "T1", color: null, tmuxSession: "tr_a_b", launchCommandOverride: null, ...over });
  };

  it("defaults a new terminal to tmux mode with no agent session", () => {
    const t = mkTerminal();
    expect(t.mode).toBe("tmux");
    expect(t.agentSessionId).toBeNull();
    expect(store.getTerminal(t.id)).toMatchObject({ mode: "tmux", agentSessionId: null });
  });

  it("round-trips a terminal created straight into gui mode with a session id", () => {
    const t = mkTerminal({ mode: "gui", agentSessionId: SESSION_ID });
    expect(t).toMatchObject({ mode: "gui", agentSessionId: SESSION_ID });
    expect(store.getTerminal(t.id)).toMatchObject({ mode: "gui", agentSessionId: SESSION_ID });
    // and it comes back the same way through the list queries the UI actually reads
    expect(store.listTerminals(t.workspaceId)[0]).toMatchObject({ mode: "gui", agentSessionId: SESSION_ID });
    expect(store.listAllTerminals().find((x) => x.id === t.id)).toMatchObject({ mode: "gui", agentSessionId: SESSION_ID });
  });

  it("setTerminalMode flips the surface both ways", () => {
    const t = mkTerminal();
    store.setTerminalMode(t.id, "gui");
    expect(store.getTerminal(t.id)?.mode).toBe("gui");
    store.setTerminalMode(t.id, "tmux");
    expect(store.getTerminal(t.id)?.mode).toBe("tmux");
  });

  it("setTerminalAgentSession sets and clears the session id", () => {
    const t = mkTerminal();
    store.setTerminalAgentSession(t.id, SESSION_ID);
    expect(store.getTerminal(t.id)?.agentSessionId).toBe(SESSION_ID);
    store.setTerminalAgentSession(t.id, null);
    expect(store.getTerminal(t.id)?.agentSessionId).toBeNull();
  });

  it("neither setter disturbs the terminal's other fields", () => {
    const t = mkTerminal({ launchCommandOverride: "claude" });
    store.updateTerminal(t.id, { title: "pinned name" });
    store.setTerminalMode(t.id, "gui");
    store.setTerminalAgentSession(t.id, SESSION_ID);
    expect(store.getTerminal(t.id)).toMatchObject({
      title: "pinned name", titleAuto: false, launchCommandOverride: "claude", position: 0,
    });
  });

  it("a row written before the mode columns existed reads as a tmux terminal", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-guimode-"));
    const dbPath = join(dir, "t.db");
    const s1 = createStore(dbPath);
    const ws = s1.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });

    // Pre-GUI-mode writers didn't know about these columns; the migration's defaults have to cover them.
    const raw = new Database(dbPath);
    raw.prepare(`INSERT INTO terminals (id,workspaceId,title,color,icon,tmuxSession,launchCommandOverride,position,createdAt,titleAuto,systemPrompt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run("tm_legacy01", ws.id, "Old tab", null, null, "tr_old_tab", null, 0, 1, 1, null);
    raw.close();

    const s2 = createStore(dbPath);
    expect(s2.getTerminal("tm_legacy01")).toMatchObject({ mode: "tmux", agentSessionId: null });
  });

  it("a mode column holding junk still reads as tmux, never as gui", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-guimode-junk-"));
    const dbPath = join(dir, "t.db");
    const s1 = createStore(dbPath);
    const ws = s1.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    const t = s1.createTerminal({ workspaceId: ws.id, title: "T1", color: null, tmuxSession: "tr_a_b", launchCommandOverride: null });

    const raw = new Database(dbPath);
    raw.prepare(`UPDATE terminals SET mode='GUI' WHERE id=?`).run(t.id); // hand-edited / wrong case
    raw.close();

    expect(createStore(dbPath).getTerminal(t.id)?.mode).toBe("tmux");
  });
});

describe("store: terminal GUI composer config", () => {
  const PICKED: GuiConfig = { model: "claude-fable-5[1m]", effort: "ultracode", permissionMode: "auto", fastMode: true };
  const mkTerminal = (over: Partial<{ guiConfig: GuiConfig }> = {}) => {
    const ws = store.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    return store.createTerminal({ workspaceId: ws.id, title: "T1", color: null, tmuxSession: "tr_a_b", launchCommandOverride: null, ...over });
  };

  it("gives a new terminal the default config", () => {
    const t = mkTerminal();
    expect(t.guiConfig).toEqual(DEFAULT_GUI_CONFIG);
    expect(store.getTerminal(t.id)!.guiConfig).toEqual(DEFAULT_GUI_CONFIG);
  });

  it("round-trips a config supplied at create time through every read path", () => {
    const t = mkTerminal({ guiConfig: PICKED });
    expect(t.guiConfig).toEqual(PICKED);
    expect(store.getTerminal(t.id)!.guiConfig).toEqual(PICKED);
    expect(store.listTerminals(t.workspaceId)[0].guiConfig).toEqual(PICKED);
    expect(store.listAllTerminals().find((x) => x.id === t.id)!.guiConfig).toEqual(PICKED);
  });

  it("setTerminalGuiConfig replaces it without disturbing the other fields", () => {
    const t = mkTerminal();
    store.updateTerminal(t.id, { title: "pinned name" });
    store.setTerminalMode(t.id, "gui");
    store.setTerminalGuiConfig(t.id, PICKED);
    expect(store.getTerminal(t.id)).toMatchObject({
      title: "pinned name", titleAuto: false, mode: "gui", position: 0, guiConfig: PICKED,
    });
  });

  it("a row written before the column existed reads as the default config", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-guicfg-legacy-"));
    const dbPath = join(dir, "t.db");
    const s1 = createStore(dbPath);
    const ws = s1.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });

    const raw = new Database(dbPath);
    raw.prepare(`INSERT INTO terminals (id,workspaceId,title,color,icon,tmuxSession,launchCommandOverride,position,createdAt,titleAuto,systemPrompt,mode,agentSessionId)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run("tm_legacy02", ws.id, "Old tab", null, null, "tr_old_tab", null, 0, 1, 1, null, "gui", null);
    raw.close();

    expect(createStore(dbPath).getTerminal("tm_legacy02")!.guiConfig).toEqual(DEFAULT_GUI_CONFIG);
  });

  it("a junk or partial guiConfig column still yields a usable config", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-guicfg-junk-"));
    const dbPath = join(dir, "t.db");
    const s1 = createStore(dbPath);
    const ws = s1.createWorkspace({ name: "A", folder: "/tmp", launchCommand: "", color: null });
    const t = s1.createTerminal({ workspaceId: ws.id, title: "T1", color: null, tmuxSession: "tr_a_b", launchCommandOverride: null });

    const raw = new Database(dbPath);
    const set = raw.prepare(`UPDATE terminals SET guiConfig=? WHERE id=?`);

    set.run("not json at all", t.id);
    expect(createStore(dbPath).getTerminal(t.id)!.guiConfig).toEqual(DEFAULT_GUI_CONFIG);

    set.run(JSON.stringify({ effort: "banana", permissionMode: "yolo" }), t.id);
    expect(createStore(dbPath).getTerminal(t.id)!.guiConfig).toEqual(DEFAULT_GUI_CONFIG);

    // a partial blob keeps what it can and defaults the rest
    set.run(JSON.stringify({ model: "opus" }), t.id);
    expect(createStore(dbPath).getTerminal(t.id)!.guiConfig).toEqual({ ...DEFAULT_GUI_CONFIG, model: "opus" });
    raw.close();
  });
});

describe("store: sticky GUI defaults", () => {
  const PICKED: GuiConfig = { model: "opus", effort: "xhigh", permissionMode: "full-access", fastMode: false };

  it("returns the defaults until something is stored", () => {
    expect(store.getGuiDefaults()).toEqual(DEFAULT_GUI_CONFIG);
  });

  it("round-trips the last choice", () => {
    store.setGuiDefaults(PICKED);
    expect(store.getGuiDefaults()).toEqual(PICKED);
  });

  it("survives a reopen and shrugs off a corrupt blob", () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-guidefaults-"));
    const dbPath = join(dir, "t.db");
    createStore(dbPath).setGuiDefaults(PICKED);
    expect(createStore(dbPath).getGuiDefaults()).toEqual(PICKED);

    const raw = new Database(dbPath);
    raw.prepare(`UPDATE settings SET value='{nope' WHERE key='guiDefaults'`).run();
    raw.close();
    expect(createStore(dbPath).getGuiDefaults()).toEqual(DEFAULT_GUI_CONFIG);
  });

  it("stays out of the flat settings object", () => {
    store.setGuiDefaults(PICKED);
    expect(store.getSettings()).not.toHaveProperty("guiDefaults");
  });
});
