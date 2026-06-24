import { useState } from "react";

/**
 * Wizard for the "+ Add a Claude Loop" affordance in the New-terminal picker. Walks the user through
 * building one of Claude Code's two built-in autonomous primitives, then hands the finished command to
 * `onStart` — the picker opens a fresh Claude session and types it in to kick off the loop.
 *
 *  - /goal <condition>      → Claude keeps working until the condition verifies (tests pass, lint clean)
 *  - /loop [interval] <task> → Claude re-runs the task on an interval (5m, 1h …) or self-paced
 */
type Mode = "goal" | "loop";

// Interval presets for /loop. "" = self-paced (omit the interval; Claude decides its own cadence).
const INTERVALS: { value: string; label: string }[] = [
  { value: "", label: "Self-paced (Claude decides)" },
  { value: "30s", label: "Every 30 seconds" },
  { value: "1m", label: "Every minute" },
  { value: "2m", label: "Every 2 minutes" },
  { value: "5m", label: "Every 5 minutes" },
  { value: "10m", label: "Every 10 minutes" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every hour" },
];

export function ClaudeLoopWizard({ claudeInstalled, starting, onStart, onClose }: {
  claudeInstalled: boolean;
  starting: boolean;
  onStart: (command: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [goal, setGoal] = useState("");
  const [task, setTask] = useState("");
  const [interval, setInterval] = useState("");

  const text = (mode === "goal" ? goal : task).trim();
  const command = !mode || !text ? "" :
    mode === "goal" ? `/goal ${text}` :
    interval ? `/loop ${interval} ${text}` : `/loop ${text}`;

  return (
    <div className="mt-5 p-4 rounded-lg border border-edge bg-panel">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-medium">Set up a Claude task</div>
        <button onClick={onClose} className="text-dim hover:text-fg text-sm leading-none">✕</button>
      </div>
      <div className="text-xs text-dim mb-3">
        Claude can run autonomously — iterating toward a goal, or repeating a task on a schedule. Pick a
        style, describe the work, and we'll open a Claude session and start the loop for you.
      </div>

      {!mode ? (
        // ── Step 1: choose the loop style ──────────────────────────────────────────────────────────
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChoiceCard
            title="Work toward a goal" cmd="/goal"
            blurb="Claude keeps working and re-checking until a condition is true — tests pass, lint clean, build green."
            onClick={() => setMode("goal")} />
          <ChoiceCard
            title="Repeat on a loop" cmd="/loop"
            blurb="Claude re-runs the same task on an interval (every 5m, 1h…) or self-paced — polling, watching, retrying."
            onClick={() => setMode("loop")} />
        </div>
      ) : (
        // ── Step 2: configure the chosen style ─────────────────────────────────────────────────────
        <div className="flex flex-col gap-3">
          {mode === "goal" ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-dim">Goal — Claude loops until this is true</span>
              <textarea autoFocus value={goal} onChange={e => setGoal(e.target.value)} rows={3}
                placeholder="all tests in test/auth pass and lint is clean"
                className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60 resize-y" />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-dim">Task — what Claude does each pass</span>
                <textarea autoFocus value={task} onChange={e => setTask(e.target.value)} rows={3}
                  placeholder="check if the deploy finished and summarize any new errors"
                  className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60 resize-y" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-dim">How often</span>
                <select value={interval} onChange={e => setInterval(e.target.value)}
                  className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60">
                  {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select>
              </label>
            </>
          )}

          {/* Live preview of the exact command we'll type into Claude. */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-dim">Claude will run</span>
            <code className="px-3 py-2 rounded bg-canvas border border-edge text-xs font-mono text-bright break-all min-h-[2.25rem] flex items-center">
              {command || <span className="text-dim">…describe the work above</span>}
            </code>
          </div>

          {!claudeInstalled && (
            <div className="text-xs text-amber-400">
              Claude CLI isn't detected on $PATH — the session will open but the loop won't start until `claude` is installed.
            </div>
          )}

          <div className="flex gap-2">
            <button disabled={!command || starting} onClick={() => onStart(command)}
              className="px-3 py-1.5 rounded bg-blue-600 text-sm disabled:opacity-40">
              {starting ? "Starting…" : "Start loop"}
            </button>
            <button onClick={() => setMode(null)} className="px-3 py-1.5 rounded bg-elevated text-sm">Back</button>
            <button onClick={onClose} className="px-3 py-1.5 rounded bg-elevated text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChoiceCard({ title, cmd, blurb, onClick }: { title: string; cmd: string; blurb: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-left p-3 rounded-lg border border-edge bg-canvas hover:border-accent/60 hover:bg-surface">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm text-bright">{title}</span>
        <code className="text-[11px] font-mono text-dim">{cmd}</code>
      </div>
      <div className="text-xs text-dim">{blurb}</div>
    </button>
  );
}
