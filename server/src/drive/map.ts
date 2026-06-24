// The special roots a Drive listing can target (vs. an explicit folderId).
export type DriveRoot = "myDrive" | "sharedWithMe" | "sharedDrives";

// A Drive file/folder normalized for the explorer. `google: true` flags a Google-native doc
// (vnd.google-apps.*) that has no raw bytes and must be exported (to PDF) on view.
export type DriveEntry = {
  id: string; name: string; type: "dir" | "file";
  mimeType: string; google: boolean;
  size: number | null; modifiedTime: string | null; webViewLink: string | null;
};

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_NATIVE = /^application\/vnd\.google-apps\./;

export function toEntry(f: {
  id: string; name: string; mimeType: string;
  size?: string | null; modifiedTime?: string | null; webViewLink?: string | null;
}): DriveEntry {
  const isFolder = f.mimeType === FOLDER_MIME;
  return {
    id: f.id, name: f.name, mimeType: f.mimeType,
    type: isFolder ? "dir" : "file",
    google: !isFolder && GOOGLE_NATIVE.test(f.mimeType),
    size: f.size != null ? Number(f.size) : null,
    modifiedTime: f.modifiedTime ?? null,
    webViewLink: f.webViewLink ?? null,
  };
}

// Google-native docs have no bytes — export Docs/Sheets/Slides/Drawings to PDF for QuickLook.
export function exportMimeFor(_mimeType: string): string { return "application/pdf"; }

// A small extension → MIME table for uploads (the host has no mime library). Drive infers a type
// from the bytes when none is given, but sending the obvious one keeps Docs/images/PDFs correct.
const MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  html: "text/html", htm: "text/html", xml: "application/xml", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  zip: "application/zip", gz: "application/gzip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export function mimeForName(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export const LIST_FIELDS = "files(id,name,mimeType,size,modifiedTime,webViewLink)";
export function listQuery(opts: { root?: DriveRoot; folderId?: string }): { q: string; corpora: string } {
  if (opts.folderId) return { q: `'${opts.folderId}' in parents and trashed=false`, corpora: "allDrives" };
  if (opts.root === "sharedWithMe") return { q: "sharedWithMe=true and trashed=false", corpora: "user" };
  // myDrive root
  return { q: "'root' in parents and trashed=false", corpora: "user" };
}
