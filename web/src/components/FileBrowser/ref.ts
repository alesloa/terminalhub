// The navigation unit for the File Browser. The explorer used to navigate by a raw host path string;
// to mount Google Drive (an ID graph, not a path tree) it now navigates by a `Ref`. Host refs behave
// exactly as before (they carry the same absolute path); drive refs carry an account + a Drive folder
// id (or a special root). `accountLabel` rides along so children can render their account.
export type DriveRoot = "myDrive" | "sharedWithMe" | "sharedDrives";

export type Ref =
  | { kind: "host"; path: string }
  | { kind: "drive"; accountId: string; accountLabel: string; fileId: string | null; root: DriveRoot | null };

export const hostRef = (path: string): Ref => ({ kind: "host", path });

// Stable string for react-query keys, React keys, and Set membership (tree expansion). A drive ref is
// keyed by its account + (special root, else folder id) so the three fixed roots stay distinct.
export function refKey(r: Ref): string {
  return r.kind === "host" ? `host:${r.path}` : `drive:${r.accountId}:${r.root ?? r.fileId}`;
}
export const sameRef = (a: Ref, b: Ref) => refKey(a) === refKey(b);

// Convenience: the host path of a host ref, else null (drive has no host path).
export const hostPathOf = (r: Ref): string | null => (r.kind === "host" ? r.path : null);
