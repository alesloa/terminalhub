import type { GuiImageAttachment } from "./types.js";

// Images attached to a prompt. The browser hands over base64 because that is the form the API takes
// — there is no file on disk for a pasted screenshot — so this module is the boundary that decides
// what is allowed through before any of it reaches the agent or the transcript.

/** The four the Anthropic API accepts. Anything else is rejected rather than passed through and
 *  failing deep inside a turn. */
export const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Per-image ceiling. The API rejects images over ~5MB; stopping short of that keeps the failure on
 *  this side of the wire, where it can be explained. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Per-turn ceiling. Every attachment is held in the transcript for the life of the session and
 *  replayed to every reconnecting client, so an unbounded count is a memory leak with a UI. */
export const MAX_IMAGES_PER_PROMPT = 5;

export type ImageCheck =
  | { ok: true; images: GuiImageAttachment[] }
  | { ok: false; error: string };

/** Decoded byte length of a base64 payload, without decoding it. */
export function base64Bytes(data: string): number {
  const len = data.length;
  if (len === 0) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}

/** Validate what the browser sent. Returns the images to attach, or the reason none were. */
export function checkImages(raw: unknown): ImageCheck {
  if (raw === undefined || raw === null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Attachments were not a list." };
  if (raw.length > MAX_IMAGES_PER_PROMPT) {
    return { ok: false, error: `At most ${MAX_IMAGES_PER_PROMPT} images per message.` };
  }

  const images: GuiImageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "An attachment was malformed." };
    const rec = item as Record<string, unknown>;
    const mediaType = typeof rec.mediaType === "string" ? rec.mediaType.toLowerCase() : "";
    const dataBase64 = typeof rec.dataBase64 === "string" ? rec.dataBase64 : "";
    if (!ALLOWED_IMAGE_TYPES.has(mediaType)) {
      return { ok: false, error: `${mediaType || "That file"} is not an image Claude can read (PNG, JPEG, GIF or WebP).` };
    }
    if (!dataBase64) return { ok: false, error: "An attachment had no data." };
    if (base64Bytes(dataBase64) > MAX_IMAGE_BYTES) {
      return { ok: false, error: `Images must be under ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB.` };
    }
    images.push({ mediaType, dataBase64 });
  }
  return { ok: true, images };
}

/** The content blocks an attached image becomes in the message sent to the model. */
export function imageContentBlock(image: GuiImageAttachment) {
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: image.mediaType, data: image.dataBase64 },
  };
}
