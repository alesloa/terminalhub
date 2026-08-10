import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GuiMessage } from "../../api/guiTypes";
import { BlockGroup } from "./MessageRow";
import { UserTurn } from "./UserTurn";
import { ToolRun } from "./ToolRun";
import { buildTranscriptRows } from "./transcriptRows";

const NEAR_BOTTOM_PX = 48; // slack so a one-line overshoot still counts as "at the bottom"

/**
 * The scrolling transcript. Sticks to the bottom while the user is already there and releases the
 * moment they scroll up, so reading back through a long turn isn't yanked away by the next delta.
 */
export function MessageList({ messages, busy, onRewind }: {
  messages: GuiMessage[];
  busy: boolean;
  onRewind: (userTurnsAfter: number, text: string, newText?: string) => void;
}) {
  // Tool calls group into runs that span messages, so the transcript is flattened into rows before
  // rendering rather than drawn one message at a time.
  const rows = useMemo(() => buildTranscriptRows(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Ref, not state: the scroll handler reads it on every wheel tick and the pin effect writes to the
  // DOM directly — neither needs a render.
  const stickRef = useRef(true);
  const [detached, setDetached] = useState(false);

  const pin = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    stickRef.current = atBottom;
    setDetached((d) => (d === !atBottom ? d : !atBottom));
  };

  // Before paint, so a growing transcript never shows a frame scrolled to the wrong place.
  useLayoutEffect(() => { if (stickRef.current) pin(); }, [messages, busy, pin]);

  // Content can also grow without a new `messages` array — a code block or table laying out a frame
  // later, or the pane itself being resized. Re-pin from the content box instead.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => { if (stickRef.current) pin(); });
    ro.observe(content);
    return () => ro.disconnect();
  }, [pin]);

  const jump = () => {
    stickRef.current = true;
    setDetached(false);
    pin();
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-4">
        {/* No empty placeholder here: an empty transcript never reaches this component — GuiChatView
            swaps in its hero instead. */}
        <div ref={contentRef} className="space-y-4">
          {rows.map((row) => {
            if (row.kind === "user") {
              return (
                <UserTurn
                  key={row.id}
                  message={row.message}
                  userTurnsAfter={row.userTurnsAfter}
                  busy={busy}
                  onRewind={onRewind}
                />
              );
            }
            if (row.kind === "tools") return <ToolRun key={row.id} blocks={row.blocks} />;
            return <BlockGroup key={row.id} blocks={row.blocks} />;
          })}
          {busy && <PendingIndicator messages={messages} />}
        </div>
      </div>

      {detached && (
        <button
          type="button"
          onClick={jump}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-edge-strong bg-elevated px-3 py-1 text-xs text-muted shadow-lg transition-colors hover:text-bright"
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}

/** Typing wave shown only while the turn has produced nothing to look at yet. */
function PendingIndicator({ messages }: { messages: GuiMessage[] }) {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.blocks.length > 0) return null;
  return (
    <span className="inline-flex items-center gap-1 py-1 text-muted" aria-label="Claude is working">
      {[0, 150, 300].map((d) => (
        <span key={d} className="tr-wave-dot h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}
