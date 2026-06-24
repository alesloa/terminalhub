import { create } from "zustand";

/** Cut/copy clipboard holding one or more paths, consumed by Paste. A single global, app-wide
 *  clipboard shared by every workspace Explorer AND the File Browser — so a copy/cut in one panel
 *  pastes in any other (one OS-style clipboard for the whole app, not per-room). */
export type Clipboard = { op: "cut" | "copy"; paths: string[] };

interface ClipboardState {
  clipboard: Clipboard | null;
  setClipboard(clip: Clipboard): void;
  clearClipboard(): void;
}

export const useClipboard = create<ClipboardState>((set) => ({
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
  clearClipboard: () => set({ clipboard: null }),
}));
