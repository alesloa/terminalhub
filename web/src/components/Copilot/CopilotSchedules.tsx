import { useMemo, useState } from "react";
import { useCopilotJobs, useCreateJob, usePatchJob, useDeleteJob, useSchedulableTools } from "../../hooks/useCopilot";
import type { CopilotJob, CopilotReportMode } from "../../api/types";

const MODE_LABEL: Record<CopilotReportMode, string> = {
  always: "Every run",
  "on-change": "When it changes",
  "on-find": "When it finds something",
};
const INTERVALS = [
  { sec: 300, label: "5 min" },
  { sec: 900, label: "15 min" },
  { sec: 1800, label: "30 min" },
  { sec: 3600, label: "1 hour" },
  { sec: 10800, label: "3 hours" },
  { sec: 21600, label: "6 hours" },
  { sec: 43200, label: "12 hours" },
  { sec: 86400, label: "1 day" },
];

// The Schedules tab — the copilot's background loops. Each loop runs one tool on an interval and
// reports back per its mode. You can create one here, but the natural path is just asking in chat
// ("check my email every 30 minutes"); this tab makes the running loops visible and manageable.
export function CopilotSchedules() {
  const jobs = useCopilotJobs();
  const [adding, setAdding] = useState(false);

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-3">
      <div className="text-xs text-dim px-1 leading-5">
        Loops run a tool on a schedule and report back. Create one below — or just ask in chat,
        e.g. <span className="text-muted">“check my email every 30 minutes”</span>.
      </div>

      {jobs.isLoading && <div className="text-sm text-dim px-1">loading…</div>}
      {jobs.data?.length === 0 && !adding && (
        <div className="text-xs text-dim px-1 py-3">No loops yet.</div>
      )}
      {jobs.data?.map((j) => <JobRow key={j.id} job={j} />)}

      {adding
        ? <NewLoopForm onDone={() => setAdding(false)} />
        : <button onClick={() => setAdding(true)}
            className="w-full text-sm px-3 py-2 rounded-xl border border-edge bg-panel hover:bg-elevated hover:text-bright transition-colors">
            + New loop
          </button>}
    </div>
  );
}

function JobRow({ job }: { job: CopilotJob }) {
  const patch = usePatchJob();
  const del = useDeleteJob();
  const everyMin = Math.round(job.intervalSec / 60);
  const every = everyMin >= 60 && everyMin % 60 === 0 ? `${everyMin / 60}h` : `${everyMin}m`;
  return (
    <div className={`rounded-xl border border-edge bg-panel p-3.5 ${job.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-blue-600/15 text-blue-400 flex items-center justify-center"><ClockIcon /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm text-bright truncate">{job.title || humanize(job.tool)}</div>
            <Toggle on={job.enabled} busy={patch.isPending} onChange={(on) => patch.mutate({ id: job.id, patch: { enabled: on } })} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Pill>every {every}</Pill>
            <Pill>{MODE_LABEL[job.reportMode]}</Pill>
            <Pill mono>{job.tool}</Pill>
          </div>
          <div className="text-[11px] text-dim mt-2">
            {job.enabled ? <>Next run {new Date(job.nextRun).toLocaleString()}</> : <>Paused</>}
            {job.lastSummary && <span className="block text-muted mt-0.5 truncate">Last: {job.lastSummary}</span>}
          </div>
        </div>
        <button onClick={() => del.mutate(job.id)} title="Delete loop"
          className="shrink-0 text-dim hover:text-red-400 px-1">✕</button>
      </div>
    </div>
  );
}

function NewLoopForm({ onDone }: { onDone: () => void }) {
  const tools = useSchedulableTools(true);
  const create = useCreateJob();
  const [tool, setTool] = useState("");
  const [title, setTitle] = useState("");
  const [intervalSec, setIntervalSec] = useState(1800);
  const [reportMode, setReportMode] = useState<CopilotReportMode>("on-change");
  const [showArgs, setShowArgs] = useState(false);
  const [argsText, setArgsText] = useState("");

  const selected = useMemo(() => tools.data?.find((t) => t.name === tool), [tools.data, tool]);
  const argsError = useMemo(() => {
    if (!argsText.trim()) return null;
    try { const v = JSON.parse(argsText); return v && typeof v === "object" && !Array.isArray(v) ? null : "Options must be a JSON object."; }
    catch { return "Options must be valid JSON."; }
  }, [argsText]);
  const canSave = !!tool && !argsError && !create.isPending;

  const save = () => {
    if (!canSave) return;
    const args = argsText.trim() ? (JSON.parse(argsText) as Record<string, unknown>) : undefined;
    create.mutate({ title: title.trim() || undefined, tool, args, intervalSec, reportMode }, { onSuccess: onDone });
  };

  const field = "w-full px-2.5 py-1.5 bg-panel border border-edge rounded-lg text-sm outline-none focus:border-blue-500/60";
  return (
    <div className="space-y-2.5 bg-panel/60 border border-edge rounded-xl p-3">
      <div>
        <label className="text-[11px] uppercase tracking-wide text-dim">What to run</label>
        <select value={tool} onChange={(e) => setTool(e.target.value)} className={`${field} mt-1`}>
          <option value="">{tools.isLoading ? "loading…" : "Pick a tool…"}</option>
          {tools.data?.map((t) => <option key={t.name} value={t.name}>{humanize(t.name)}</option>)}
        </select>
        {selected && <div className="text-[11px] text-dim mt-1 leading-4">{selected.description}</div>}
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[11px] uppercase tracking-wide text-dim">How often</label>
          <select value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))} className={`${field} mt-1`}>
            {INTERVALS.map((i) => <option key={i.sec} value={i.sec}>{i.label}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-[11px] uppercase tracking-wide text-dim">Report</label>
          <select value={reportMode} onChange={(e) => setReportMode(e.target.value as CopilotReportMode)} className={`${field} mt-1`}>
            <option value="on-change">{MODE_LABEL["on-change"]}</option>
            <option value="on-find">{MODE_LABEL["on-find"]}</option>
            <option value="always">{MODE_LABEL.always}</option>
          </select>
        </div>
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Label (optional)" className={field} />

      <button onClick={() => setShowArgs((v) => !v)} className="text-[11px] text-dim hover:text-muted">
        {showArgs ? "▾" : "▸"} Options (advanced)
      </button>
      {showArgs && (
        <div>
          <textarea value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={3}
            placeholder={'{ "provider": "gmail" }'} spellCheck={false}
            className={`${field} font-mono text-[12px] leading-5 resize-y`} />
          <div className="text-[10px] text-dim mt-0.5 leading-4">JSON arguments passed to the tool each run. Leave blank for defaults.</div>
        </div>
      )}

      {argsError && <div className="text-[11px] text-red-300">{argsError}</div>}
      {create.isError && <div className="text-[11px] text-red-300">{(create.error as Error).message}</div>}
      <div className="flex justify-end gap-2 pt-0.5">
        <button onClick={onDone} className="text-xs px-2.5 py-1 rounded bg-elevated hover:bg-edge">Cancel</button>
        <button onClick={save} disabled={!canSave} className="text-xs px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white">
          {create.isPending ? "Creating…" : "Create loop"}
        </button>
      </div>
    </div>
  );
}

// "email_check" → "Email check". Tool names are snake_case + stable; this is display-only.
function humanize(name: string): string {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

function Pill({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <span className={`text-[10px] px-2 py-0.5 rounded-full bg-elevated/60 border border-edge text-muted ${mono ? "font-mono" : ""}`}>{children}</span>;
}

function Toggle({ on, busy, onChange }: { on: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} disabled={busy} role="switch" aria-checked={on} title={on ? "Pause" : "Resume"}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-blue-600" : "bg-elevated"} ${busy ? "opacity-50" : ""}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
