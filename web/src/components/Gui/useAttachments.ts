import { useCallback, useState } from "react";
import { NO_IMAGES, useGuiDraft, type StagedImage } from "../../store/guiDraft";

// Images staged for the next prompt. Pasting a screenshot is the whole point: describing a broken
// screen in words is strictly worse than showing it.
//
// The staged list lives in the draft store, keyed by terminal, so it survives the chat unmounting
// when you look at another terminal — the same reason the typed text does. Only the error message is
// local: it belongs to the paste that just failed, not to the draft.

export type { StagedImage };

/** The four the API reads. Anything else is rejected here so the failure is visible at the moment of
 *  the paste, not swallowed into a turn that then behaves oddly. */
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES = 5;

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

export function useAttachments(terminalId: string) {
  const images = useGuiDraft((s) => s.drafts[terminalId]?.images ?? NO_IMAGES);
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
    useGuiDraft.getState().setImages(terminalId, (prev) => {
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
  }, [terminalId]);

  const remove = useCallback((id: string) => {
    useGuiDraft.getState().setImages(terminalId, (prev) => {
      const dropped = prev.find((i) => i.id === id);
      if (dropped) URL.revokeObjectURL(dropped.url);
      return prev.filter((i) => i.id !== id);
    });
  }, [terminalId]);

  return { images, error, add, remove, dismissError: useCallback(() => setError(null), []) };
}
