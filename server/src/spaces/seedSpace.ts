import type { Store } from "../db/store.js";
import type { Workspace } from "../types.js";
import { seedWorkspace, type SeedResult } from "./seeder.js";
import { mergeSpaceConfig } from "./merge.js";
import { EMPTY_SPACE_CONFIG, isEmptySpaceConfig, type SpaceConfig } from "./types.js";

// Bridges a workspace to the config that should be seeded into its folder: the merge of its owning
// space's wizard config and the workspace's OWN config (additive — see merge.ts). Called right
// before an agent launches (terminal create) and on workspace create, so the folder's
// .claude/.mcp.json/.env/rules are in place before the CLI reads them. Best-effort: a seeding
// failure must never block the user.

/** Space config ⊕ workspace config — the config actually seeded into this workspace's folder. */
export function effectiveConfig(store: Store, ws: Workspace): SpaceConfig {
  const base = (ws.spaceId ? store.getSpace(ws.spaceId)?.config : null) ?? EMPTY_SPACE_CONFIG;
  const over = ws.config ?? EMPTY_SPACE_CONFIG;
  return mergeSpaceConfig(base, over);
}

/** Seed one workspace from its effective (space ⊕ own) config. No-op (null) when that's empty. */
export async function seedWorkspaceEffective(store: Store, ws: Workspace): Promise<SeedResult | null> {
  const config = effectiveConfig(store, ws);
  if (isEmptySpaceConfig(config)) return null;
  try {
    return await seedWorkspace(ws.folder, config);
  } catch {
    return null; // never let a bad folder/permission stop terminal or workspace creation
  }
}

/** Seed a single workspace by id from its effective config — the per-workspace "apply now". */
export async function seedWorkspaceById(store: Store, workspaceId: string): Promise<SeedResult | null> {
  const ws = store.getWorkspace(workspaceId);
  if (!ws) return null;
  return seedWorkspaceEffective(store, ws);
}

export interface SpaceSeedReport { workspaceId: string; name: string; folder: string; result: SeedResult | null }

/** Re-seed every workspace in a space (each from its effective config) — the "apply now" used after
 *  creating/editing a space's config. */
export async function seedSpace(store: Store, spaceId: string): Promise<SpaceSeedReport[]> {
  const workspaces = store.listWorkspaces().filter((w) => w.spaceId === spaceId);
  const out: SpaceSeedReport[] = [];
  for (const ws of workspaces) {
    const result = await seedWorkspaceEffective(store, ws);
    out.push({ workspaceId: ws.id, name: ws.name, folder: ws.folder, result });
  }
  return out;
}
