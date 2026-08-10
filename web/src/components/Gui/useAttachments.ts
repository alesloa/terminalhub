import { useCallback, useState } from "react";
import type { GuiImageAttachment } from "../../api/guiTypes";

// Images staged for the next prompt. Pasting a screenshot is the whole point: describing a broken
// screen in words is strictly worse than showing it.

/** The four the API reads. Anything else is rejected here so the failure is visible at the moment of
 *  the paste, not swallowed into a turn that then behaves oddly. */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 5;

export interface StagedImage extends GuiImageAttachment {
  id: string;
  /** Object URL for the thumbnail. Revoked when the image is dropped. */
  url: string;
}

/** Read a File as bare base64 (no data-URI prefix). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function useAttachments() {
  const [images, setImages] = useState<StagedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(async (files: File[]) => {
    const usable = files.filter((f) => f.type && ALLOWED.has(f.type.toLowerCase()));
    if (!usable.length) {
      if (files.length) setError("Only PNG, JPEG, GIF and WebP images can be attached.");
      return;
    }
    if (usable.some((f) => f.size > MAX_BYTES)) {
      setError(`Images must be under ${Math.round(MAX_BYTES / (1024 * 1024))}MB.`);
      return;
    }

    const read = await Promise.all(usable.map(async (file) => ({
      id: `${file.name}:${file.size}:${file.lastModified}:${Math.random().toString(36).slice(2)}`,
      mediaType: file.type.toLowerCase(),
      dataBase64: await toBase64(file),
      url: URL.createObjectURL(file),
    })));

    setError(null);
    setImages((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        setError(`At most ${MAX_IMAGES} images per message.`);
        read.forEach((r) => URL.revokeObjectURL(r.url));
        return prev;
      }
      // Over the limit: keep what fits rather than dropping the whole paste.
      read.slice(room).forEach((r) => URL.revokeObjectURL(r.url));
      return [...prev, ...read.slice(0, room)];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setImages((prev) => {
      prev.find((i) => i.id === id)?.url && URL.revokeObjectURL(prev.find((i) => i.id === id)!.url);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setImages((prev) => { prev.forEach((i) => URL.revokeObjectURL(i.url)); return []; });
  }, []);

  return { images, error, add, remove, clear, dismissError: useCallback(() => setError(null), []) };
}
