import { create } from "zustand";

/** A confirm request. `danger` paints the confirm button red (the default — these replace native
 *  confirm() prompts, which are overwhelmingly destructive). `dismissable` lets a backdrop click
 *  cancel; it defaults to false for this global modal (the user must press a button or the ✕). */
export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  dismissable?: boolean;
}

interface ConfirmState {
  current: (ConfirmRequest & { id: number }) | null;
  resolver: ((ok: boolean) => void) | null;
  open(req: ConfirmRequest): Promise<boolean>;
  answer(ok: boolean): void;
}

let seq = 0;
/** Select single fields (`useConfirm(s => s.current)`) — never return a new object literal, which
 *  would break Zustand's snapshot caching. Mirrors the useToasts pattern. */
export const useConfirm = create<ConfirmState>((set, get) => ({
  current: null,
  resolver: null,
  open: (req) =>
    new Promise<boolean>((resolve) => {
      // Only one dialog at a time: if one is already open, resolve it as cancelled first.
      get().resolver?.(false);
      set({ current: { ...req, id: ++seq }, resolver: resolve });
    }),
  answer: (ok) => {
    const r = get().resolver;
    set({ current: null, resolver: null });
    r?.(ok);
  },
}));

/** Imperative replacement for window.confirm: `if (await confirmModal({ title, body })) { … }`.
 *  Resolves true when the user confirms, false on cancel / close / Escape. */
export function confirmModal(req: ConfirmRequest): Promise<boolean> {
  return useConfirm.getState().open(req);
}
