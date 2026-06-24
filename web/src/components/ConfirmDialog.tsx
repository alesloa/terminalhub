import { useEffect, useRef } from "react";

/**
 * A small modal confirm for destructive actions (e.g. Discard / Delete). Enter confirms, Esc
 * cancels, the confirm button autofocuses, and a ✕ in the corner cancels too. By default a
 * backdrop click also cancels (`dismissable`); pass `dismissable={false}` for a hard confirm the
 * user must answer with a button. Styled to match NewWorkspaceModal.
 */
export function ConfirmDialog({ title, body, confirmLabel = "Confirm", cancelLabel = "Cancel",
  danger = true, dismissable = true, onConfirm, onCancel }:
  { title: string; body: string; confirmLabel?: string; cancelLabel?: string;
    danger?: boolean; dismissable?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]"
      onMouseDown={dismissable ? onCancel : undefined}>
      <div className="relative bg-panel w-[420px] rounded-lg p-5 flex flex-col gap-3 border border-edge"
        onMouseDown={(e) => e.stopPropagation()}>
        <button onClick={onCancel} aria-label="Close" title="Close"
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-dim hover:text-fg hover:bg-elevated leading-none">✕</button>
        <h2 className="text-lg pr-6">{title}</h2>
        <p className="text-sm text-muted whitespace-pre-line">{body}</p>
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onCancel} className="px-3 py-1.5 bg-elevated rounded hover:bg-edge">{cancelLabel}</button>
          <button ref={confirmRef} onClick={onConfirm}
            className={`px-3 py-1.5 rounded text-white ${danger ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
