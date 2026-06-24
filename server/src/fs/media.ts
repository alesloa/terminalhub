/**
 * Helpers for streaming media files (video, mainly) straight off disk over HTTP — the path 4K/large
 * files take, since they can't ride the base64-in-JSON file-bytes route (whole file into memory, 25 MiB
 * cap). The route in routes/media.ts wires these to a node `createReadStream` so the browser's <video>
 * element gets real byte-range streaming and seeking.
 */

/** Extension → MIME for the media stream's Content-Type. Covers the video formats a browser <video>
 *  decodes (mp4/webm/ogg reliably; mov/mkv/etc. depend on the codec) and the audio formats <audio>
 *  plays (mp3/m4a/aac/wav/flac/ogg/opus), plus a few of each it usually can't — those still open the
 *  player, which offers a Reveal/Open-externally fallback on error. `.ogg` is mapped to audio (Vorbis,
 *  by far its common use); video Ogg/Theora uses `.ogv`. */
const MEDIA_MIME: Record<string, string> = {
  // Video
  mp4: "video/mp4", m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  "3gp": "video/3gpp", "3g2": "video/3gpp2",
  m2ts: "video/mp2t", mts: "video/mp2t", ts: "video/mp2t",
  // Audio
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav", wave: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  weba: "audio/webm",
  wma: "audio/x-ms-wma",
};

/** MIME for a media file by name, or application/octet-stream when unmapped (the browser sniffs). */
export function mediaTypeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return MEDIA_MIME[ext] ?? "application/octet-stream";
}

/** An inclusive [start, end] byte range. */
export type ParsedRange = { start: number; end: number };
/** parseRange's outcome: a concrete range, "unsatisfiable" (→ 416), or null (no/invalid range → 200). */
export type RangeResult = ParsedRange | "unsatisfiable" | null;

/**
 * Parse an HTTP `Range` header against a known file `size`. Returns an inclusive {start,end} for a
 * single satisfiable range, the string "unsatisfiable" when the range falls entirely past EOF (the
 * caller answers 416), or null when there's no range / it's malformed / it's a multi-range request
 * (the caller serves the whole file with 200). Supports the three single-range forms browsers send:
 * closed `bytes=a-b`, open-ended `bytes=a-`, and suffix `bytes=-n` (the last n bytes).
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return null;
  const prefix = "bytes=";
  if (!header.startsWith(prefix)) return null;
  const spec = header.slice(prefix.length).trim();
  if (spec.includes(",")) return null; // multi-range — serve the whole file instead
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === "" && endStr === "") return null; // "bytes=-" is malformed

  // Suffix range: the last `n` bytes.
  if (startStr === "") {
    const n = parseInt(endStr, 10);
    if (!n) return "unsatisfiable"; // "bytes=-0" requests nothing
    return { start: Math.max(0, size - n), end: size - 1 };
  }

  const start = parseInt(startStr, 10);
  if (start >= size) return "unsatisfiable";

  // Open-ended range: from `start` to EOF.
  if (endStr === "") return { start, end: size - 1 };

  // Closed range: clamp the end to the last byte; a start past the end is malformed.
  const end = parseInt(endStr, 10);
  if (start > end) return null;
  return { start, end: Math.min(end, size - 1) };
}
