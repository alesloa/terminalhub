import { useTv } from "./store";
import { CloseIcon } from "./icons";

/** Bottom-center undo pill for the TV window — raised by the YouTube remove/ban actions via the store's
 *  showToast. Self-clears after 6s (store timer); "Undo" runs the captured restore callback. Rendered
 *  once inside TvModal so it sits inside the window and reads the locked .tv-scope palette. */
export function TvToast() {
  const toast = useTv((s) => s.toast);
  const clearToast = useTv((s) => s.clearToast);
  if (!toast) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[78px] z-[60] flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] border border-edge-strong bg-elevated px-4 py-2.5 text-[12.5px] text-fg shadow-2xl">
        <span>{toast.msg}</span>
        {toast.onUndo && (
          <button onClick={() => { toast.onUndo?.(); clearToast(); }}
            className="font-semibold text-accent hover:underline">Undo</button>
        )}
        <button onClick={clearToast} aria-label="Dismiss"
          className="grid h-5 w-5 place-items-center rounded text-dim hover:text-fg"><CloseIcon size={13} /></button>
      </div>
    </div>
  );
}
