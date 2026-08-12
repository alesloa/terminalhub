import { memo, useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";

/**
 * A plan Claude proposed via ExitPlanMode. The server captures the plan and tells Claude to stop and
 * wait, so this card is the whole handoff: without it the plan is written and then silently dropped.
 *
 * The buttons only send ordinary prompts — approving a plan does not quietly widen the agent's
 * permissions, which is a thing you'd want to decide yourself with the permissions pill.
 */
export const PlanCard = memo(function PlanCard({
  text, busy, onApprove, onDismiss,
}: {
  text: string;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const html = useMemo(() => renderMarkdown(text), [text]);

  return (
    <div className="shrink-0 border-t border-accent/30 bg-accent/5 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Plan ready
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-auto text-[11px] text-dim transition-colors hover:text-bright"
        >
          Dismiss
        </button>
      </div>

      <div className="tr-markdown tr-chat-md max-h-64 overflow-y-auto text-sm leading-6 [&>*+*]:!mt-2 [&_h1]:!text-[1rem] [&_h2]:!text-[0.95rem] [&_h2]:!border-0 [&_h3]:!text-sm [&_pre]:!p-2 [&_pre]:!text-[11px]"
        dangerouslySetInnerHTML={{ __html: html }} />

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onApprove}
          className="rounded-lg bg-accent px-2.5 py-1 text-xs text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Go ahead
        </button>
        <span className="text-[11px] text-dim">or type a reply to change the plan</span>
      </div>
    </div>
  );
});
