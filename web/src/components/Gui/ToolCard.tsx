import { memo, useMemo, useState } from "react";
import type { GuiBlock } from "../../api/guiTypes";
import { asRecord, asString, DiffBlock, diffInputOf, fileDiffsOf, PatchDiff } from "./DiffBlock";
import { useTurnActive } from "./turnActive";

export type GuiToolBlock = Extract<GuiBlock, { kind: "tool" }>;

const SUMMARY_CHARS = 160;
const RESULT_CHARS = 4000; // a full Read result can be megabytes; the card is a summary, not a viewer

/**
 * The one-line "what is this call actually doing" string. Specialised for the tools whose interesting
 * field is obvious, then a generic fallback (first string field, else compact JSON) so an MCP tool
 * nobody anticipated still reads as something rather than blank.
 */
export function summarizeToolInput(name: string, input: unknown): string {
  const rec = asRecord(input);
  if (!rec) return oneLine(typeof input === "string" ? input : "");
  const pick = (...keys: string[]) => {
    for (const k of keys) { const v = asString(rec[k]); if (v) return v; }
    return null;
  };
  let picked: string | null;
  switch (name) {
    case "Read": case "Edit": case "MultiEdit": case "Write": case "NotebookEdit": case "ApplyPatch":
      picked = pick("file_path", "notebook_path", "path"); break;
    case "UpdatePlan":
      picked = pick("plan"); break;
    case "Bash": case "BashOutput": case "KillShell":
      picked = pick("command", "description", "shell_id"); break;
    case "Grep": case "Glob":
      picked = pick("pattern"); break;
    case "WebFetch":
      picked = pick("url"); break;
    case "WebSearch":
      picked = pick("query"); break;
    case "Task":
      picked = pick("description", "subagent_type"); break;
    default:
      picked = null;
  }
  return oneLine(picked ?? genericSummary(rec));
}

function genericSummary(rec: Record<string, unknown>): string {
  for (const v of Object.values(rec)) { const s = asString(v); if (s) return s; }
  return safeJson(rec);
}

function safeJson(v: unknown, indent?: number): string {
  try { return JSON.stringify(v, null, indent) ?? ""; } catch { return ""; }
}

/** Collapse to a single line and clip — a summary that wraps stops being a summary. */
function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS)}…` : flat;
}

/**
 * One tool call: status + name + one-line input summary, expanding to the full input (as a diff when
 * the tool edits a file) and the result. Memoized because a streaming turn hands MessageRow a new
 * blocks array on every flush while these blocks themselves are unchanged.
 */
export const ToolCard = memo(function ToolCard({ block }: { block: GuiToolBlock }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeToolInput(block.name, block.input), [block.name, block.input]);
  const diff = useMemo(() => diffInputOf(block.name, block.input), [block.name, block.input]);
  const patch = useMemo(() => (diff ? null : fileDiffsOf(block.input)), [diff, block.input]);
  // A patch already IS its input, printed line by line — repeating it as JSON underneath would double
  // the longest card in the transcript for nothing.
  const inputJson = useMemo(() => (open && !patch ? safeJson(block.input, 2) : ""), [open, patch, block.input]);

  // A card only spins while a turn is actually in flight. A block left "running" by a run that died
  // has nothing left to settle it, so the transcript's own liveness decides instead of the block.
  const turnActive = useTurnActive();
  const status = block.status === "running" && !turnActive ? "aborted" : block.status;

  const failed = status === "error";
  const result = block.result ?? "";
  const clipped = result.length > RESULT_CHARS;

  return (
    <div className={`rounded-lg border text-xs ${failed ? "border-error/40 bg-error/5" : "border-edge bg-panel"}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-elevated/60 rounded-lg transition-colors"
      >
        <StatusIcon status={status} />
        <span className="shrink-0 font-mono text-bright">{block.name}</span>
        {summary && <span className="min-w-0 flex-1 truncate font-mono text-dim">{summary}</span>}
        <Chevron open={open} />
      </button>

      {/* An error is the one thing worth reading without expanding. */}
      {failed && !open && result && (
        <div className="border-t border-error/30 px-2.5 py-1.5 font-mono text-[11px] text-error">{oneLine(result)}</div>
      )}

      {open && (
        <div className="space-y-2 border-t border-edge px-2.5 py-2">
          {diff && <DiffBlock oldText={diff.oldText} newText={diff.newText} />}
          {patch && <PatchDiff files={patch} />}
          {inputJson && (
            <Section label="Input">
              <pre className="max-h-64 overflow-auto rounded-md border border-edge bg-code px-2.5 py-1.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all">{inputJson}</pre>
            </Section>
          )}
          {result && (
            <Section label={failed ? "Error" : "Result"}>
              <pre className={`max-h-64 overflow-auto rounded-md border border-edge bg-code px-2.5 py-1.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all ${failed ? "text-error" : "text-fg"}`}>
                {clipped ? `${result.slice(0, RESULT_CHARS)}\n…truncated` : result}
              </pre>
            </Section>
          )}
          {!result && status === "running" && <div className="text-[11px] text-dim">Running…</div>}
          {!result && status === "aborted" && (
            <div className="text-[11px] text-dim">No result — the run ended before this call reported back.</div>
          )}
        </div>
      )}
    </div>
  );
});

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-wide text-dim">{label}</div>
      {children}
    </div>
  );
}

function StatusIcon({ status }: { status: GuiToolBlock["status"] }) {
  if (status === "running") return <Spinner />;
  if (status === "error") return <span className="shrink-0 text-error">✕</span>;
  // Not a failure and not a success — the run ended before this call said either way.
  if (status === "aborted") return <span className="shrink-0 text-dim" aria-label="no result">–</span>;
  return <span className="shrink-0 text-success">✓</span>;
}

const Spinner = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0 animate-spin text-muted" aria-label="running">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
    strokeLinecap="round" strokeLinejoin="round"
    className={`shrink-0 text-dim transition-transform ${open ? "rotate-180" : ""}`}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
