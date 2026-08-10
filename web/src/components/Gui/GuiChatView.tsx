import { useEffect, useRef } from "react";
import type { GuiSessionState } from "../../api/guiTypes";
import { basename } from "../../lib/paths";
import { useUi } from "../../store/ui";
import { PlanCard } from "./PlanCard";
import { ApprovalBar } from "./ApprovalBar";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { useGuiSocket } from "./useGuiSocket";

// Which token paints the state dot. Every value of GuiSessionState is listed so adding one to the
// contract is a compile error here rather than a silently grey dot.
const STATE_TONE: Record<GuiSessionState, string> = {
  idle: "bg-dim",
  starting: "bg-warn",
  running: "bg-accent",
  waiting: "bg-info",
  stopped: "bg-dim",
  error: "bg-error",
};

/**
 * GUI mode for one terminal: the in-app Claude chat that replaces the xterm pane. Fills its parent —
 * the caller owns the frame, this owns the transcript, the prompt, and the status line.
 */
export function GuiChatView({ terminalId, folder }: { terminalId: string; folder: string }) {
  const gui = useGuiSocket(terminalId);
  const empty = gui.messages.length === 0 && !gui.busy;
  const rootRef = useRef<HTMLDivElement>(null);

  // Report focus the same way a pane does. This is the flag the notification layer reads to decide
  // "you're already looking at this one, don't toast" — without it a GUI chat would alert you for a
  // turn finishing on screen in front of you.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onFocusIn = () => useUi.getState().setFocusedTerminal(terminalId);
    const onFocusOut = (e: FocusEvent) => {
      if (el.contains(e.relatedTarget as Node | null)) return; // focus moved within the chat
      if (useUi.getState().focusedTerminalId === terminalId) useUi.getState().setFocusedTerminal(null);
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    if (el.contains(document.activeElement)) onFocusIn();
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      if (useUi.getState().focusedTerminalId === terminalId) useUi.getState().setFocusedTerminal(null);
    };
  }, [terminalId]);

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-canvas text-fg">
      {/* Transcript and composer share one flex column so the empty state can centre them as a pair.
          With a transcript, MessageList takes the slack and the composer pins to the bottom; without
          one there's no flex-1 child, so `justify-center` floats the hero + composer group. A single
          Composer instance across both layouts — remounting it would drop whatever was half-typed. */}
      <div className={`flex min-h-0 flex-1 flex-col ${empty ? "justify-center" : ""}`}>
        {empty
          ? <EmptyHero folder={folder} />
          : (
            <MessageList
              messages={gui.messages}
              busy={gui.busy}
              onRewind={gui.rewind}
              onPreviewRewind={gui.previewRewind}
              rewindPreview={gui.rewindPreview}
            />
          )}

        {gui.error && (
          <div className="shrink-0 border-t border-error/30 bg-error/10 px-4 py-2 text-xs text-error">{gui.error}</div>
        )}
        {/* Not a failure — the outcome of something that already happened, e.g. how many files a
            rewind put back. Kept out of the transcript because it isn't part of the conversation. */}
        {gui.notice && (
          <div className="shrink-0 border-t border-edge bg-elevated/60 px-4 py-2 text-xs text-muted">{gui.notice}</div>
        )}

        {gui.plan && (
          <PlanCard
            text={gui.plan}
            busy={gui.busy}
            onApprove={() => gui.send("Approved — go ahead and implement the plan.")}
            onDismiss={gui.dismissPlan}
          />
        )}

        <ApprovalBar
          approval={gui.pendingApproval}
          question={gui.pendingQuestion}
          onApprove={gui.approve}
          onAnswer={gui.answer}
        />

        <Composer
          terminalId={terminalId}
          folder={folder}
          busy={gui.busy}
          connected={gui.connected}
          config={gui.config}
          hero={empty}
          contextUsage={gui.contextUsage}
          costUsd={gui.costUsd}
          onSend={gui.send}
          onInterrupt={gui.interrupt}
          onConfig={gui.setConfig}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-edge bg-panel px-3 py-1 text-[11px] text-dim">
        <span className="min-w-0 truncate font-mono" title={folder}>{basename(folder) || folder}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${STATE_TONE[gui.state]}`} />
          <span>{gui.busy ? "working" : gui.state}</span>
        </span>
        {gui.sessionId && (
          <span className="shrink-0 font-mono" title={gui.sessionId}>· {gui.sessionId.slice(0, 8)}</span>
        )}
        {!gui.connected && <span className="shrink-0 text-warn">· disconnected</span>}
      </div>
    </div>
  );
}

/** What a blank chat opens on. Naming the folder is the point — a room can hold several terminals in
 *  several projects, and this is the one line that says which one you're about to talk about. */
function EmptyHero({ folder }: { folder: string }) {
  return (
    <div className="shrink-0 px-6 pb-3 pt-6 text-center">
      <h2 className="text-lg font-medium leading-snug text-bright sm:text-xl">
        What should we build in{" "}
        <span
          className="decoration-edge-strong underline decoration-dotted decoration-2 underline-offset-4"
          title={folder}
        >
          {basename(folder) || folder}
        </span>
        ?
      </h2>
    </div>
  );
}
