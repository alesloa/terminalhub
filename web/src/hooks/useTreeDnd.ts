import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { FsListing } from "../api/types";
import { useRoom } from "../store/room";
import { useToasts } from "../store/toasts";
import { basename, dedupeName, dirname, join } from "../lib/paths";

/**
 * Intra-Explorer drag-and-drop: moving files/folders onto another folder (real-explorer style),
 * one row or a whole multi-selection at once. The move primitive is fsRename — the same one
 * cut/paste-move and inline rename use. Kept apart from useExplorerMenu so the recursive FileTree
 * can own its own drop targets without pulling in the whole right-click menu surface.
 */
export function useTreeDnd() {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const expandDirs = useRoom(s => s.expandDirs);
  const select = useRoom(s => s.selectExplorer);
  const openFiles = useRoom(s => s.openFiles);
  const openFile = useRoom(s => s.openFile);
  const closeFile = useRoom(s => s.closeFile);

  const namesIn = (dir: string) =>
    new Set((qc.getQueryData<FsListing>(["fs", dir])?.entries ?? []).map(e => e.name));

  // A single move is valid unless: the target IS the source, the target sits inside the source's own
  // subtree (can't move a folder into itself), or the target is already the source's parent (a no-op).
  // dirname() of a top-level item is "/", which never matches a real target dir.
  const canMove = (targetDir: string, source: string): boolean =>
    targetDir !== source &&
    !targetDir.startsWith(source + "/") &&
    targetDir !== dirname(source);

  // A drop is allowed if at least one of the dragged paths can move into the target (the rest are
  // skipped at drop time). Drives the drop-target highlight during dragover.
  const canDrop = (targetDir: string, sources: string[]): boolean => sources.some(s => canMove(targetDir, s));

  // Move every valid source into `targetDir`. Dedupe leaves against the target AND against each other
  // (so two same-named items both land), re-point any open editor tab to its new path (mirrors inline
  // rename), clear the now-stale selection, expand the target, then refresh the tree + git colours.
  const move = async (targetDir: string, sources: string[]) => {
    const valid = sources.filter(s => canMove(targetDir, s));
    if (!valid.length) return;
    try {
      const taken = namesIn(targetDir);
      for (const source of valid) {
        const name = dedupeName(basename(source), taken);
        taken.add(name);
        const dest = join(targetDir, name);
        await api.fsRename(source, dest);
        if (openFiles.some(f => f.path === source)) { closeFile(source); openFile({ path: dest, name }); }
      }
      select(null); // the moved rows no longer exist at their old paths — drop the stale highlight
      expandDirs([targetDir]);
      qc.invalidateQueries({ queryKey: ["fs"] });
      qc.invalidateQueries({ queryKey: ["git"] });
    } catch (e) {
      push(`Move failed: ${(e as Error).message}`);
    }
  };

  return { canMove, canDrop, move };
}
