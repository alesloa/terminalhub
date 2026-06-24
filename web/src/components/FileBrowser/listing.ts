import { api } from "../../api/client";
import type { FsEntry, DriveEntry } from "../../api/types";
import { hostRef, type Ref } from "./ref";

// One folder entry, normalized across backends. It carries its own `ref` so navigation never
// re-parses a path. `google` flags a Drive-native doc (exported to PDF on view); `webViewLink` is
// the "Open in Google" target (drive only); `readable` is the host's per-entry readability (drive
// entries are always readable through the API).
export type BrowserEntry = {
  ref: Ref;
  name: string;
  type: "dir" | "file";
  google: boolean;
  webViewLink: string | null;
  readable: boolean;
};

// The dispatcher: list a folder regardless of backend. Host → /api/fs/list (today's behavior, with
// `showHidden`); drive → /api/drive/list (ignores `showHidden`). Both map into BrowserEntry so the
// leaf components stay backend-agnostic.
export async function listRef(ref: Ref, showHidden: boolean): Promise<BrowserEntry[]> {
  if (ref.kind === "host") {
    const { entries } = await api.fsList(ref.path, showHidden);
    return entries.map((e: FsEntry) => ({
      ref: hostRef(e.path), name: e.name, type: e.type, google: false, webViewLink: null, readable: e.readable,
    }));
  }
  const { entries } = await api.driveList(ref.accountId, { folder: ref.fileId ?? undefined, root: ref.root ?? undefined });
  return entries.map((e: DriveEntry) => ({
    ref: { kind: "drive", accountId: ref.accountId, accountLabel: ref.accountLabel, fileId: e.id, root: null },
    name: e.name, type: e.type, google: e.google, webViewLink: e.webViewLink, readable: true,
  }));
}
