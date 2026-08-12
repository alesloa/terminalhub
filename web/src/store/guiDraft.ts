import { create } from "zustand";
import type { GuiImageAttachment } from "../api/guiTypes";

/**
 * What is half-typed into a GUI chat's composer, per terminal.
 *
 * This lives in a store rather than in the Composer's own state because the chat UNMOUNTS the moment
 * you look at another terminal — and a message you were still composing must not be thrown away for
 * glancing at something else. Same reasoning as the commit box (see commitDraft.ts): the draft
 * belongs to the terminal, not to whichever component happens to be showing it.
 *
 * Attachments live here too. Their object URLs stay valid for the life of the document, so a staged
 * screenshot survives the same round trip; only `clear` (a sent message, or an explicit remove)
 * revokes one.
 */
export interface StagedImage extends GuiImageAttachment {
  id: string;
  /** Object URL for the thumbnail. Revoked when the image is dropped or the draft is cleared. */
  url: string;
}

export interface GuiDraft {
  text: string;
  images: StagedImage[];
}

/** Stable empty values, so a terminal with no draft yet doesn't hand out a new object every render
 *  (which would re-run every selector subscribed to it). */
export const NO_IMAGES: StagedImage[] = [];
const EMPTY: GuiDraft = { text: "", images: NO_IMAGES };

interface GuiDraftState {
  drafts: Record<string, GuiDraft>;
  setText(terminalId: string, text: string): void;
  /** Update the staged images. Takes the previous list so callers can append or filter without
   *  reading the store first. */
  setImages(terminalId: string, next: (prev: StagedImage[]) => StagedImage[]): void;
  /** Empty the composer — the sent-message path. Revokes the thumbnails it drops. */
  clear(terminalId: string): void;
}

export const useGuiDraft = create<GuiDraftState>((set, get) => {
  const patch = (terminalId: string, part: Partial<GuiDraft>) =>
    set((s) => ({ drafts: { ...s.drafts, [terminalId]: { ...(s.drafts[terminalId] ?? EMPTY), ...part } } }));
  return {
    drafts: {},
    setText: (terminalId, text) => patch(terminalId, { text }),
    setImages: (terminalId, next) => patch(terminalId, { images: next(get().drafts[terminalId]?.images ?? NO_IMAGES) }),
    clear: (terminalId) => {
      for (const image of get().drafts[terminalId]?.images ?? NO_IMAGES) URL.revokeObjectURL(image.url);
      patch(terminalId, { text: "", images: NO_IMAGES });
    },
  };
});
