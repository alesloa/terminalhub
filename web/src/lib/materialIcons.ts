import { generateManifest } from "material-icon-theme";

// VS Code "Material Icon Theme" (PKief), always on. The package ships the same
// SVGs + filename/foldername associations the VS Code extension uses; we resolve
// a path to an icon URL with the official `generateManifest()` output.
//
// Vite emits every icon as a hashed static asset; the browser fetches only the
// ones actually referenced. `query: "?url"` keeps these out of the JS bundle.
const svgUrls = import.meta.glob(
  "../../../node_modules/material-icon-theme/icons/*.svg",
  { query: "?url", import: "default", eager: true },
) as Record<string, string>;

// basename (no extension) -> emitted asset URL, e.g. "typescript" -> "/assets/typescript-ab12.svg"
const urlByName = new Map<string, string>();
for (const [filePath, url] of Object.entries(svgUrls)) {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1).replace(/\.svg$/, "");
  urlByName.set(base, url);
}

const manifest = generateManifest();

const fileExtensions = (manifest.fileExtensions ?? {}) as Record<string, string>;
const fileNames = (manifest.fileNames ?? {}) as Record<string, string>;
const folderNames = (manifest.folderNames ?? {}) as Record<string, string>;
const folderNamesExpanded = (manifest.folderNamesExpanded ?? {}) as Record<string, string>;

// iconDefinitions[id].iconPath looks like "./../icons/typescript.svg" -> URL for "typescript".
function urlForIcon(iconId: string | undefined): string | undefined {
  if (!iconId) return undefined;
  const iconPath = manifest.iconDefinitions?.[iconId]?.iconPath;
  if (!iconPath) return undefined;
  const base = iconPath.slice(iconPath.lastIndexOf("/") + 1).replace(/\.svg$/, "");
  return urlByName.get(base);
}

const defaultFile = urlForIcon(manifest.file);
const defaultFolder = urlForIcon(manifest.folder);
const defaultFolderOpen = urlForIcon(manifest.folderExpanded);

/** Material icon URL for a file name (matches VS Code: exact name, then longest extension). */
export function getFileIconUrl(name: string): string | undefined {
  const lower = name.toLowerCase();

  const byName = fileNames[lower];
  if (byName) return urlForIcon(byName) ?? defaultFile;

  // Longest extension wins: "component.test.ts" -> "test.ts" before "ts".
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const ext = parts.slice(i).join(".");
    const id = fileExtensions[ext];
    if (id) return urlForIcon(id) ?? defaultFile;
  }

  return defaultFile;
}

/** Material icon URL for a folder name, by open/closed state. */
export function getFolderIconUrl(name: string, expanded: boolean): string | undefined {
  const lower = name.toLowerCase();
  const table = expanded ? folderNamesExpanded : folderNames;
  const fallback = expanded ? defaultFolderOpen : defaultFolder;

  const id = table[lower] ?? (lower.startsWith(".") ? table[lower.slice(1)] : undefined);
  return urlForIcon(id) ?? fallback;
}
