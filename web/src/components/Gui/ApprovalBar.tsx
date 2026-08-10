import { useState } from "react";
import type { GuiApprovalDecision, GuiApprovalRequest, GuiQuestionRequest } from "../../api/guiTypes";
import { summarizeToolInput } from "./ToolCard";

interface Props {
  approval: GuiApprovalRequest | null;
  question: GuiQuestionRequest | null;
  onApprove: (id: string, decision: GuiApprovalDecision) => void;
  onAnswer: (id: string, answers: Record<string, string[]>) => void;
}

/**
 * The one blocking prompt between the transcript and the composer: either a tool the agent needs a
 * yes for, or an AskUserQuestion. Keyed on the request id so a second request never inherits the
 * previous one's half-made selections.
 */
export function ApprovalBar({ approval, question, onApprove, onAnswer }: Props) {
  if (approval) return <ApprovalPrompt key={approval.id} request={approval} onApprove={onApprove} />;
  if (question) return <QuestionPrompt key={question.id} request={question} onAnswer={onAnswer} />;
  return null;
}

function ApprovalPrompt({ request, onApprove }: { request: GuiApprovalRequest; onApprove: Props["onApprove"] }) {
  const summary = summarizeToolInput(request.toolName, request.input);
  return (
    <div className="shrink-0 border-t border-warn/30 bg-warn/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-bright">
            Run <code className="font-mono">{request.toolName}</code>?
          </div>
          {summary && <div className="truncate font-mono text-xs text-muted" title={summary}>{summary}</div>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => onApprove(request.id, "deny")}
            className="rounded-md bg-elevated px-3 py-1 text-sm text-fg transition-colors hover:bg-edge-strong">
            Deny
          </button>
          {request.canAllowForSession && (
            <button type="button" onClick={() => onApprove(request.id, "allowForSession")}
              className="rounded-md border border-edge-strong bg-panel px-3 py-1 text-sm text-fg transition-colors hover:bg-elevated">
              Allow for session
            </button>
          )}
          <button type="button" onClick={() => onApprove(request.id, "allow")}
            className="rounded-md bg-accent px-3 py-1 text-sm text-accent-fg transition-colors hover:bg-accent-hover">
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionPrompt({ request, onAnswer }: { request: GuiQuestionRequest; onAnswer: Props["onAnswer"] }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  // One single-select question is a pure button choice — submitting it separately is a pointless
  // extra click, so answer straight through.
  const immediate = request.questions.length === 1 && !request.questions[0].multiSelect;
  const complete = request.questions.every((q) => (picked[q.id] ?? []).length > 0);

  const toggle = (qid: string, label: string, multiSelect: boolean) => {
    if (immediate) { onAnswer(request.id, { [qid]: [label] }); return; }
    setPicked((prev) => {
      const cur = prev[qid] ?? [];
      if (!multiSelect) return { ...prev, [qid]: [label] };
      return { ...prev, [qid]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  };

  return (
    <div className="max-h-72 shrink-0 space-y-3 overflow-y-auto border-t border-info/30 bg-info/10 px-4 py-3">
      {request.questions.map((q) => {
        const sel = picked[q.id] ?? [];
        return (
          <div key={q.id} className="space-y-1.5">
            {q.header && <div className="text-[10px] font-medium uppercase tracking-wide text-dim">{q.header}</div>}
            <div className="text-sm text-bright">{q.question}</div>
            {q.multiSelect && <div className="text-[11px] text-dim">Pick as many as apply.</div>}
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => {
                const on = sel.includes(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    title={o.description || undefined}
                    onClick={() => toggle(q.id, o.label, q.multiSelect)}
                    className={`rounded-lg border px-3 py-1.5 text-left text-xs transition-colors ${
                      on ? "border-accent bg-accent text-accent-fg" : "border-edge bg-panel text-fg hover:bg-elevated"
                    }`}
                  >
                    <span className="block font-medium">{o.label}</span>
                    {o.description && (
                      <span className={`block max-w-[22rem] text-[11px] ${on ? "opacity-80" : "text-dim"}`}>{o.description}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {!immediate && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!complete}
            onClick={() => onAnswer(request.id, picked)}
            className="rounded-md bg-accent px-3 py-1 text-sm text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
