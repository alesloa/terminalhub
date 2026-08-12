import { useEffect, useMemo, useState } from "react";
import type { GuiMessage } from "../../api/guiTypes";

/**
 * The "it is still working" line at the foot of the transcript.
 *
 * Rendered for the WHOLE of a running turn — never suppressed because a block happens to have landed.
 * The stop button alone is not a sign of life: between a finished tool card and the next token there
 * can be a minute of silence, and a transcript that shows nothing moving reads as a hang. So this
 * says what KIND of thing is happening (running, reading, thinking) and how long the turn has been
 * going, and keeps the dots moving the entire time.
 *
 * Deliberately just the verb. The card for the very tool being described sits directly above this
 * line with its own spinner and its own arguments, so repeating the command here said the same thing
 * twice — once truncated.
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
  const label = waitingOnUser ? "Waiting for you" : activity;

  return (
    <div className="flex items-center gap-2 py-1 text-xs text-muted" role="status" aria-live="polite" aria-label={label}>
      <span className="inline-flex shrink-0 items-center gap-1">
        {[0, 150, 300].map((d) => (
          <span key={d} className="tr-wave-dot h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span className="shrink-0 text-bright">{label}</span>
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
    // ApplyPatch is Codex's edit tool — one call carries every file in the patch.
    case "Edit": case "MultiEdit": case "NotebookEdit": case "ApplyPatch": return "Editing";
    case "Bash": case "BashOutput": return "Running";
    case "Grep": case "Glob": return "Searching";
    case "WebFetch": case "WebSearch": return "Browsing";
    case "Task": case "Agent": return "Delegating";
    case "TodoWrite": case "UpdatePlan": return "Planning";
    default: return `Running ${name}`;
  }
}

function describe(messages: GuiMessage[]): string {
  // Latest first: a parallel batch is described by its size, a single call by what it is doing.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const running = msg.blocks.filter((b) => b.kind === "tool" && b.status === "running");
    if (running.length > 1) return `Running ${running.length} tools`;
    const one = running[0];
    if (one && one.kind === "tool") return verb(one.name);
    const last = msg.blocks[msg.blocks.length - 1];
    if (last?.kind === "thinking") return "Thinking";
    if (last?.kind === "text") return "Responding";
    break;
  }
  return "Working";
}
