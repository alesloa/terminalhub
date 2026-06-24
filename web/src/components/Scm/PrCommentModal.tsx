import { useEffect, useRef, useState } from "react";

/**
 * Multi-line comment box for a pull request (`gh pr comment`). Enter inserts a newline; ⌘/Ctrl+Enter
 * posts. Esc / backdrop cancels. Styled to match ConfirmDialog / LabelModal.
 */
export function PrCommentModal({ prNumber, onSubmit, onCancel }:
  { prNumber: number; onSubmit: (body: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = () => { const v = value.trim(); if (v) onSubmit(v); };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onCancel}>
      <div className="bg-panel w-[480px] rounded-lg p-5 flex flex-col gap-3 border border-edge"
        onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-lg">Comment on #{prNumber}</h2>
        <textarea ref={ref} value={value} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
          rows={5} placeholder="Leave a comment…  (⌘↵ to post)"
          className="px-2 py-1.5 text-sm bg-canvas border border-edge rounded outline-none focus:border-blue-500 resize-none" />
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onCancel} className="px-3 py-1.5 bg-elevated rounded">Cancel</button>
          <button onClick={submit} className="px-3 py-1.5 bg-blue-600 rounded hover:bg-blue-500">Comment</button>
        </div>
      </div>
    </div>
  );
}
