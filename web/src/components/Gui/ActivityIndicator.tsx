import { useEffect, useMemo, useState } from "react";
import type { GuiMessage } from "../../api/guiTypes";
import { summarizeToolInput } from "./ToolCard";

const DETAIL_CHARS = 64;

/**
 * The "it is still working" line at the foot of the transcript.
 *
 * Rendered for the WHOLE of a running turn — never suppressed because a block happens to have landed.
 * The stop button alone is not a sign of life: between a finished tool card and the next token there
 * can be a minute of silence, and a transcript that shows nothing moving reads as a hang. So this
 * says what is happening right now (which tool, or thinking/responding) and how long the turn has
 * been going, and keeps the dots moving the entire time.
 */
export function ActivityIndicator({ messages, waitingOnUser }: {
  messages: GuiMessage[];
  waitingOnUser: boolean;
}) {
  // Mounted for exactly one turn (the parent renders it only while busy), so mount time IS turn start.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const activity = useMemo(() => describe(messages), [messages]);
  const label = waitingOnUser ? "Waiting for you" : activity.label;
  const detail = waitingOnUser ? "" : activity.detail;

  return (
    <div
      className="flex items-center gap-2 py-1 text-xs text-muted"
      role="status"
      aria-live="polite"
      aria-label={`${label}${detail ? ` ${detail}` : ""}`}
    >
      <span className="inline-flex shrink-0 items-center gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="tr-wave-dot h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span className="shrink-0 text-bright">{label}</span>
      {detail && <span className="truncate font-mono text-[11px] text-dim">{detail}</span>}
      <span className="ml-auto shrink-0 tabular-nums text-dim">{clock(elapsed)}</span>
    </div>
  );
}

/** `45s`, then `2m 05s` — a turn that has been going a while should look like it. */
function clock(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

/** Present tense for the tools worth naming; anything else falls back to its own name. */
function verb(name: string): string {
  switch (name) {
    case "Read": case "NotebookRead": return "Reading";
    case "Write": return "Writing";
    case "Edit": case "MultiEdit": case "NotebookEdit": return "Editing";
    case "Bash": case "BashOutput": return "Running";
    case "Grep": case "Glob": return "Searching";
    case "WebFetch": case "WebSearch": return "Browsing";
    case "Task": case "Agent": return "Delegating";
    case "TodoWrite": return "Planning";
    default: return `Running ${name}`;
  }
}

function describe(messages: GuiMessage[]): { label: string; detail: string } {
  // Latest first: a parallel batch is described by its size, a single call by what it is doing.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const running = msg.blocks.filter((b) => b.kind === "tool" && b.status === "running");
    if (running.length > 1) return { label: `Running ${running.length} tools`, detail: "" };
    const one = running[0];
    if (one && one.kind === "tool") return { label: verb(one.name), detail: tail(summarizeToolInput(one.name, one.input)) };
    const last = msg.blocks[msg.blocks.length - 1];
    if (last?.kind === "thinking") return { label: "Thinking", detail: "" };
    if (last?.kind === "text") return { label: "Responding", detail: "" };
    break;
  }
  return { label: "Working", detail: "" };
}

/** Clip from the FRONT — the end of a path or a command is the part that identifies it. */
function tail(s: string): string {
  return s.length > DETAIL_CHARS ? `…${s.slice(s.length - DETAIL_CHARS)}` : s;
}
