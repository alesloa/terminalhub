import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useRoom, type ExplorerEdit } from "../store/room";
import { useToasts } from "../store/toasts";
import { basename, dirname, join } from "../lib/paths";

/**
 * Commits an inline tree edit (rename / new file / new folder). Split from useExplorerMenu so
 * the recursive FileTree can drive its edit inputs without pulling in the whole menu surface.
 * An empty/unchanged name is a no-op (acts like cancel).
 */
export function useExplorerEdit() {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const openFile = useRoom(s => s.openFile);
  const closeFile = useRoom(s => s.closeFile);
  const openFiles = useRoom(s => s.openFiles);
  const expandDirs = useRoom(s => s.expandDirs);

  async function commitEdit(edit: ExplorerEdit, raw: string) {
    const name = raw.trim();
    if (!name) return;
    const done = () => { qc.invalidateQueries({ queryKey: ["fs"] }); qc.invalidateQueries({ queryKey: ["git"] }); };
    try {
      if (edit.mode === "rename") {
        const old = edit.target;
        if (name === basename(old)) return;
        const dest = join(dirname(old), name);
        await api.fsRename(old, dest);
        // Keep an open editor tab usable after its file is renamed.
        if (openFiles.some(f => f.path === old)) { closeFile(old); openFile({ path: dest, name }); }
      } else if (edit.mode === "new-file") {
        const dest = join(edit.target, name);
        await api.fsCreateFile(dest);
        openFile({ path: dest, name });
      } else {
        const dest = join(edit.target, name);
        await api.fsMkdir(dest);
        expandDirs([dest]);
      }
      done();
    } catch (e) {
      push((e as Error).message);
    }
  }

  return { commitEdit };
}
