import { useEffect, useRef, useState } from "react";

/**
 * Small text-input modal for naming a labeled bookmark (or editing an existing label). Enter
 * confirms, Esc/backdrop cancels. Styled to match ConfirmDialog / NewWorkspaceModal.
 */
export function LabelModal({ title, initial = "", confirmLabel = "Save", onConfirm, onCancel }:
  { title: string; initial?: string; confirmLabel?: string; onConfirm: (label: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => { const v = value.trim(); if (v) onConfirm(v); };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onCancel}>
      <div className="bg-panel w-[420px] rounded-lg p-5 flex flex-col gap-3 border border-edge"
        onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg">{title}</h2>
        <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Bookmark label…"
          className="px-2 py-1.5 text-sm bg-canvas border border-edge rounded outline-none focus:border-blue-500" />
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onCancel} className="px-3 py-1.5 bg-elevated rounded">Cancel</button>
          <button onClick={submit} className="px-3 py-1.5 bg-blue-600 rounded hover:bg-blue-500">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
