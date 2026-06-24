import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GitCommit } from "../../api/types";
import { fmtDate } from "./parts";

interface Props {
  commit: GitCommit;
  rect: DOMRect;          // the row's bounding box — the card anchors to it
  onCopySha: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CARD_W = 360;

/** VS Code's commit hover card: author + email, the full message, then date and short SHA. */
export function CommitHoverCard({ commit, rect, onCopySha, onMouseEnter, onMouseLeave }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure once mounted, then place to the RIGHT of the row, staying viewport-aware:
  // flip to the left if it would overflow the right edge, and ride up if it would spill
  // past the bottom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const gap = 8;
    let left = rect.right + gap;
    if (left + CARD_W > window.innerWidth - 8) left = rect.left - CARD_W - gap; // flip left
    left = Math.max(8, Math.min(left, window.innerWidth - CARD_W - 8));
    let top = rect.top;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8; // ride up off the bottom
    top = Math.max(8, top);
    setPos({ left, top });
  }, [rect]);

  return createPortal(
    <div
      ref={ref}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        left: pos?.left ?? rect.right + 8,
        top: pos?.top ?? rect.top,
        width: CARD_W,
        zIndex: 65,
        visibility: pos ? "visible" : "hidden",
      }}
      className="rounded-lg border border-edge bg-panel shadow-2xl px-3 py-2.5 text-sm select-text"
    >
      <div className="flex items-center gap-2 text-fg">
        <PersonIcon />
        <span className="font-medium text-fg truncate">{commit.author}</span>
        <span className="text-dim text-xs truncate">{commit.email}</span>
      </div>

      <div className="my-2 h-px bg-edge" />

      <div className="text-bright leading-snug whitespace-pre-wrap break-words">{commit.subject}</div>
      {commit.body && (
        <div className="mt-2 text-xs text-muted leading-relaxed whitespace-pre-wrap break-words">{commit.body}</div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-dim">
        <span>{fmtDate(commit.date)}</span>
        <span className="flex items-center gap-1.5">
          <CommitIcon />
          <span className="font-mono text-muted">{commit.hash.slice(0, 8)}</span>
          <button
            onClick={onCopySha}
            title="Copy Commit SHA"
            className="ml-0.5 w-5 h-5 grid place-items-center rounded hover:bg-elevated text-muted hover:text-bright"
          >
            <CopyIcon />
          </button>
        </span>
      </div>
    </div>,
    document.body,
  );
}

function PersonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="shrink-0 text-muted">
      <circle cx="8" cy="5" r="2.6" />
      <path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4" strokeLinecap="round" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="shrink-0 text-dim">
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 2v3M8 11v3" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M3.5 10.5h-.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v.5" strokeLinecap="round" />
    </svg>
  );
}
