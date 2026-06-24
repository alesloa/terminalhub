import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { GitCommit } from "../../api/types";

interface Props {
  commit: GitCommit;
  isHead: boolean;            // only the tip can be undone (soft reset HEAD~1)
  x: number; y: number;       // cursor position the menu opens at
  onOpenChanges: () => void;
  onCopySha: () => void;
  onCopyMessage: () => void;
  onUndo: () => void;
  dismiss: () => void;
}

const MENU_W = 224, MENU_H = 220;

/** Right-click menu for a commit row in the graph — mirrors VS Code's history-item menu. */
export function CommitContextMenu({ isHead, x, y, onOpenChanges, onCopySha, onCopyMessage, onUndo, dismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) dismiss(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    // Defer the outside-click listener a frame so the opening right-click doesn't close it.
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 8));
  const run = (fn: () => void) => { fn(); dismiss(); };

  // Portal to <body> so position:fixed is viewport-relative (the Room has a transform that
  // would otherwise become the containing block).
  return createPortal(
    <div ref={ref} style={{ position: "fixed", left, top, zIndex: 70 }}
      className="w-56 py-1 rounded-lg border border-edge bg-panel shadow-2xl text-sm text-fg select-none">
      <Item label="Open Changes" onClick={() => run(onOpenChanges)} />
      <Sep />
      <Item label="Copy Commit SHA" onClick={() => run(onCopySha)} />
      <Item label="Copy Commit Message" onClick={() => run(onCopyMessage)} />
      <Sep />
      {/* Rewriting a commit's message requires interactive history editing we don't expose. */}
      <Item label="Edit Commit Message" disabled />
      <Item label={isHead ? "Undo Commit" : "Undo Commit (not HEAD)"} disabled={!isHead} onClick={() => run(onUndo)} />
    </div>,
    document.body,
  );
}

function Item({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="w-full px-3 py-1.5 text-left hover:bg-elevated disabled:opacity-30 disabled:hover:bg-transparent">
      {label}
    </button>
  );
}

function Sep() {
  return <div className="my-1 h-px bg-edge" />;
}
