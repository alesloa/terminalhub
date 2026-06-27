import { useMemo, useState, type CSSProperties } from "react";
import type { TimeCatalog } from "./useTimeCatalog";
import { dayStart, fromLocalInput, toLocalInput } from "./util";

interface Props {
  catalog: TimeCatalog;
  accent: string | null;
  day: number;                                                  // selected day (ms) — manual defaults land here
  onStart: (b: { client: string; project?: string; task?: string; notes?: string }) => void;
  onAdd: (b: { client: string; project?: string; task?: string; notes?: string; startedAt: number; stoppedAt: number }) => void;
  onDone?: () => void;   // fired after a successful submit — lets the popup close itself
}

/**
 * The "New time entry" card (mirrors Harvest's): Client / Project / Task comboboxes (free-typed,
 * suggestions from the catalog — unknown names are auto-added on the server), a Notes field, and a
 * Start timer button. The "Add past entry" toggle swaps Start for two date/time pickers + an Add
 * button so you can log time you forgot to track.
 */
export function NewEntryForm({ catalog, accent, day, onStart, onAdd, onDone }: Props) {
  const [client, setClient] = useState("");
  const [project, setProject] = useState("");
  const [task, setTask] = useState("");
  const [notes, setNotes] = useState("");
  const [manual, setManual] = useState(false);
  const [startAt, setStartAt] = useState(() => toLocalInput(dayStart(day) + 9 * 3600_000));
  const [stopAt, setStopAt] = useState(() => toLocalInput(dayStart(day) + 10 * 3600_000));

  // Project suggestions scoped to the typed client (matched by name → id).
  const clientId = useMemo(() => catalog.clients.find((c) => c.name.toLowerCase() === client.trim().toLowerCase())?.id ?? null, [catalog.clients, client]);
  const projectOptions = catalog.projectsFor(clientId);

  const accentStyle: CSSProperties | undefined = accent ? { backgroundColor: accent } : undefined;
  const reset = () => { setProject(""); setTask(""); setNotes(""); };

  const submit = () => {
    const c = client.trim();
    if (!c) return;
    const base = { client: c, project: project.trim() || undefined, task: task.trim() || undefined, notes: notes.trim() || undefined };
    if (manual) {
      const s = fromLocalInput(startAt), e = fromLocalInput(stopAt);
      if (s === null || e === null || e < s) return;
      onAdd({ ...base, startedAt: s, stoppedAt: e });
    } else {
      onStart(base);
    }
    reset();
    onDone?.();
  };

  const field = "w-full px-2 py-1.5 bg-elevated border border-edge rounded text-sm focus:outline-none focus:border-edge-strong";

  return (
    <div className="border border-edge rounded-lg p-3 bg-panel/40 space-y-2">
      <datalist id="ts-clients">{catalog.clientsActive.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <datalist id="ts-projects">{projectOptions.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <datalist id="ts-tasks">{catalog.tasksActive.map((t) => <option key={t.id} value={t.name} />)}</datalist>

      <div className="grid grid-cols-2 gap-2">
        <input list="ts-clients" className={field} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
        <input list="ts-projects" className={field} placeholder="Project" value={project} onChange={(e) => setProject(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input list="ts-tasks" className={field} placeholder="Task (e.g. Programming)" value={task} onChange={(e) => setTask(e.target.value)} />
        <input className={field} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>

      {manual && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-dim">Start<input type="datetime-local" className={field} value={startAt} onChange={(e) => setStartAt(e.target.value)} /></label>
          <label className="text-xs text-dim">Stop<input type="datetime-local" className={field} value={stopAt} onChange={(e) => setStopAt(e.target.value)} /></label>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={submit} disabled={!client.trim()} style={accentStyle}
          className={`px-3 py-1.5 rounded text-sm text-white disabled:opacity-40 ${accent ? "" : "bg-green-600 hover:bg-green-500"}`}>
          {manual ? "Add entry" : "Start timer"}
        </button>
        <button onClick={() => setManual((m) => !m)} className="px-2 py-1.5 text-xs text-dim hover:text-fg">
          {manual ? "Cancel" : "Add past entry"}
        </button>
      </div>
    </div>
  );
}
