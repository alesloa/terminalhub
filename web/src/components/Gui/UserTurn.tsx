import { useEffect, useRef, useState } from "react";
import type { GuiMessage } from "../../api/guiTypes";
import { ImageBlock } from "./MessageRow";

/**
 * One user turn, with edit and delete.
 *
 * Both are rewinds: Claude's conversation is an append-only chain, so cutting at a turn necessarily
 * drops everything after it. Editing re-sends the turn reworded from that point; deleting just drops
 * it. The chat says so before it does it — this is the one control here that throws work away.
 */
export function UserTurn({
  message, userTurnsAfter, busy, onRewind,
}: {
  message: GuiMessage;
  userTurnsAfter: number;
  busy: boolean;
  onRewind: (userTurnsAfter: number, text: string, newText?: string, restoreFiles?: boolean) => void;
}) {
  const text = message.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("").trim();
  const images = message.blocks.filter((b) => b.kind === "image");
  // Whether a rewind should also put the working tree back. Off by default: dropping a message is
  // not the same request as throwing away the code it produced.
  const [restoreFiles, setRestoreFiles] = useState(false);
  const [mode, setMode] = useState<"idle" | "edit" | "confirm-delete">("idle");
  const [draft, setDraft] = useState(text);

  // A rewind rebuilds the transcript, so a row that survives one must not keep a half-typed edit of
  // a message that may no longer be the same turn.
  useEffect(() => { setMode("idle"); setDraft(text); }, [text]);

  if (!text && !images.length) return null;

  if (mode === "edit") {
    return (
      <EditBox
        draft={draft}
        onDraft={setDraft}
        restoreFiles={restoreFiles}
        onRestoreFiles={setRestoreFiles}
        onCancel={() => { setDraft(text); setMode("idle"); }}
        onSave={() => {
          const next = draft.trim();
          if (!next || next === text) { setMode("idle"); setDraft(text); return; }
          onRewind(userTurnsAfter, text, next, restoreFiles);
          setMode("idle");
        }}
      />
    );
  }

  return (
    <div className="group flex justify-end">
      <div className="flex max-w-[85%] flex-col items-end gap-1">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {images.map((b) => <ImageBlock key={b.id} mediaType={b.mediaType} dataBase64={b.dataBase64} />)}
          </div>
        )}
        {text && (
          <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm leading-6 text-accent-fg">
            {text}
          </div>
        )}

        {mode === "confirm-delete" ? (
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span>Delete this and everything after it?</span>
            <RestoreFilesToggle checked={restoreFiles} onChange={setRestoreFiles} />
            <button
              type="button"
              onClick={() => { onRewind(userTurnsAfter, text, undefined, restoreFiles); setMode("idle"); }}
              className="rounded-md border border-error/40 px-2 py-0.5 text-error transition-colors hover:bg-error/10"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="rounded-md border border-edge px-2 py-0.5 transition-colors hover:text-bright"
            >
              Cancel
            </button>
          </div>
        ) : (
          // Hidden until hover or keyboard focus, so a read-through of the chat isn't littered with
          // controls — but still reachable by Tab.
          <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <RowButton
              label="Edit and resend"
              disabled={busy}
              onClick={() => { setDraft(text); setMode("edit"); }}
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </RowButton>
            <RowButton label="Delete from here" disabled={busy} onClick={() => setMode("confirm-delete")}>
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </RowButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** Opt in to putting the files back the way they were at this message. The agent keeps a backup of
 *  every file it edits, so this is a real undo rather than a guess — but it is never the default:
 *  rewriting the working tree is not what "delete a message" asks for. */
function RestoreFilesToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1 select-none" title="Restore every file the agent edited after this message">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 accent-[color:var(--tr-accent)]"
      />
      <span>undo file changes</span>
    </label>
  );
}

function EditBox({
  draft, onDraft, onSave, onCancel, restoreFiles, onRestoreFiles,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  restoreFiles: boolean;
  onRestoreFiles: (v: boolean) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow with the text — an edit box that scrolls at three lines is worse than the bubble it replaced.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [draft]);

  return (
    <div className="flex justify-end">
      <div className="w-[85%] rounded-2xl border border-edge-strong bg-panel p-2">
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onCancel(); }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSave(); }
          }}
          rows={1}
          className="w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-6 text-fg outline-none"
        />
        <div className="flex items-center justify-end gap-2 px-1 pt-1 text-[11px]">
          <span className="mr-auto text-dim">Resending drops everything after this message</span>
          <RestoreFilesToggle checked={restoreFiles} onChange={onRestoreFiles} />
          <button type="button" onClick={onCancel} className="rounded-md border border-edge px-2 py-0.5 text-muted transition-colors hover:text-bright">
            Cancel
          </button>
          <button type="button" onClick={onSave} className="rounded-md bg-accent px-2 py-0.5 text-accent-fg transition-opacity hover:opacity-90">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function RowButton({
  label, disabled, onClick, children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={disabled ? "Stop the agent first" : label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1 text-dim transition-colors hover:bg-elevated/60 hover:text-bright disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-dim"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
