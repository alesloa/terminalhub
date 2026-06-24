/**
 * Image files we can render inline (raster + svg). Deliberately excludes tiff/heic — browsers can't
 * display those, so they'd show a broken image; they stay as the "binary file" message instead.
 * Shared by the editor's image-preview routing (room.ts) and the file browser's Quick Look.
 */
export const isImageFile = (name: string) =>
  /\.(png|apng|jpe?g|jfif|pjpeg|pjp|gif|bmp|webp|avif|ico|cur|svg)$/i.test(name);

/** HTML documents that can open into the rich view (rendered iframe preview + drag-drop builder). */
export const isHtmlFile = (name: string) => /\.(html?|xhtml)$/i.test(name);

/** PDFs, which open straight into the faithful native-viewer reader (web/src/components/Editor/PdfView). */
export const isPdfFile = (name: string) => /\.pdf$/i.test(name);

/**
 * Video files that open inline in the editor tab / File Browser Quick Look (VideoView) instead of a
 * code/editor tab — streamed off disk with HTTP byte-range support, so 4K/large files play and seek
 * without loading into memory. Broad on purpose ("pretty much any video"): formats the browser can't
 * decode still open the player, which offers a Reveal / Open-externally fallback when playback errors.
 * `.ts` is deliberately excluded — it collides with TypeScript source (MPEG-TS uses .m2ts/.mts here);
 * `.ogg` routes to audio (it's overwhelmingly Vorbis audio), video Ogg/Theora is `.ogv`.
 */
export const isVideoFile = (name: string) =>
  /\.(mp4|m4v|mov|webm|ogv|mkv|avi|wmv|flv|3gp|3g2|m2ts|mts)$/i.test(name);

/**
 * Audio files that open inline in the editor tab / File Browser Quick Look (AudioView) — same off-disk
 * byte-range stream as video, so seeking works without loading the file into memory. Broad on purpose;
 * a format the browser can't decode still opens the player with a Reveal / Open-externally fallback.
 */
export const isAudioFile = (name: string) =>
  /\.(mp3|m4a|aac|wav|wave|flac|oga|ogg|opus|weba|wma)$/i.test(name);

// Text/code/config extensions the File Browser can open in its editable code editor. Deliberately
// broad (covers the common languages, data, and config formats) but excludes known binaries — those
// fall through to Quick Look. Kept lowercase; matched case-insensitively.
const EDITABLE_EXT =
  /\.(txt|text|log|md|markdown|mdx|rst|adoc|tex|csv|tsv|json|json5|jsonc|ya?ml|toml|ini|cfg|conf|config|env|properties|xml|plist|svgz?|html?|xhtml|css|scss|sass|less|styl|js|jsx|mjs|cjs|ts|tsx|mts|cts|vue|svelte|astro|py|pyi|rb|php|pl|pm|lua|go|rs|java|kt|kts|scala|swift|c|h|cc|cpp|cxx|hpp|hh|m|mm|cs|fs|fsx|clj|cljs|edn|ex|exs|erl|hrl|hs|ml|mli|r|jl|dart|groovy|gradle|sql|graphql|gql|prisma|sh|bash|zsh|fish|ps1|bat|cmd|cmake|diff|patch|lock)$/i;

/**
 * True when a file should open in the File Browser's editable code editor (vs. Quick Look). Images
 * and PDFs are excluded (they preview); SVG counts as editable text here since it's hand-editable
 * markup. Extensionless names (Dockerfile, Makefile, LICENSE, README) and dotfiles (.gitignore, .env,
 * .bashrc) are treated as editable text. Used to route double-click and to gate "Edit" on Drive
 * files (host files can always be force-opened in the editor, which reports binaries itself).
 */
export function isEditableTextName(name: string): boolean {
  const base = (name.split("/").pop() ?? name).trim();
  if (!base) return false;
  if (isPdfFile(base)) return false;
  if (isImageFile(base) && !/\.svgz?$/i.test(base)) return false; // svg is editable markup
  if (!base.includes(".")) return true;   // Dockerfile, Makefile, LICENSE, README
  if (base.startsWith(".")) return true;   // .gitignore, .env, .bashrc
  return EDITABLE_EXT.test(base);
}

/** Extension → MIME for an image data URL. Falls back to octet-stream for the unmapped. */
export const imageMime = (name: string): string => {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return IMAGE_MIME[ext] ?? "application/octet-stream";
};

const IMAGE_MIME: Record<string, string> = {
  png: "image/png", apng: "image/apng",
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", pjpeg: "image/jpeg", pjp: "image/jpeg",
  gif: "image/gif", bmp: "image/bmp",
  webp: "image/webp", avif: "image/avif",
  ico: "image/x-icon", cur: "image/x-icon",
  svg: "image/svg+xml",
};
