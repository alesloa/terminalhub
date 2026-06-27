import { useMemo, useState, type CSSProperties } from "react";
import type { TimeEntry } from "../../api/types";
import type { TimeCatalog } from "./useTimeCatalog";
import { dayStart, fromLocalInput, toLocalInput } from "./util";

type Base = { client: string; project?: string; task?: string; notes?: string };

interface Props {
  catalog: TimeCatalog;
  accent: string | null;
  day: number;                                                  // selected day (ms) — manual defaults land here
  onStart: (b: Base) => void;
  onAdd: (b: Base & { startedAt: number; stoppedAt: number }) => void;
  onDone?: () => void;                                          // fired after a successful submit — closes the popup
  editEntry?: TimeEntry | null;                                 // present → edit mode (Save + Delete, times always shown)
  onSave?: (id: string, patch: Partial<Pick<TimeEntry, "client" | "project" | "task" | "notes" | "startedAt" | "stoppedAt">>) => void;
  onDelete?: (id: string) => void;
  defaults?: { client?: string; project?: string; task?: string; manual?: boolean };  // prefill (cell/day add)
}

/**
 * The Client / Project / Task / Notes form behind the + popup. Three modes:
 *  - add (default): comboboxes + "Start timer" / "Add past entry" toggle.
 *  - add-prefilled: same, but seeded (a week cell or calendar day) — usually opens straight in manual mode.
 *  - edit: an existing entry → fields prefilled, start/stop always shown, "Save" + "Delete".
 * Unknown client/project/task names are auto-added to the catalog server-side.
 */
export function NewEntryForm({ catalog, accent, day, onStart, onAdd, onDone, editEntry, onSave, onDelete, defaults }: Props) {
  const isEdit = !!editEntry;
  const [client, setClient] = useState(editEntry?.client ?? defaults?.client ?? "");
  const [project, setProject] = useState(editEntry?.project ?? defaults?.project ?? "");
  const [task, setTask] = useState(editEntry?.task ?? defaults?.task ?? "");
  const [notes, setNotes] = useState(editEntry?.notes ?? "");
  const [manual, setManual] = useState(isEdit || !!defaults?.manual);
  const [startAt, setStartAt] = useState(() => toLocalInput(editEntry?.startedAt ?? dayStart(day) + 9 * 3600_000));
  const [stopAt, setStopAt] = useState(() =>
    editEntry ? (editEntry.stoppedAt === null ? "" : toLocalInput(editEntry.stoppedAt)) : toLocalInput(dayStart(day) + 10 * 3600_000));

  // Project suggestions scoped to the typed client (matched by name → id).
  const clientId = useMemo(() => catalog.clients.find((c) => c.name.toLowerCase() === client.trim().toLowerCase())?.id ?? null, [catalog.clients, client]);
  const projectOptions = catalog.projectsFor(clientId);

  const accentStyle: CSSProperties | undefined = accent ? { backgroundColor: accent } : undefined;
  const showTimes = manual || isEdit;

  const submit = () => {
    const c = client.trim();
    if (!c) return;
    if (isEdit && editEntry && onSave) {
      const s = fromLocalInput(startAt);
      onSave(editEntry.id, {
        client: c, project: project.trim(), task: task.trim(), notes: notes.trim(),
        ...(s !== null ? { startedAt: s } : {}),
        stoppedAt: fromLocalInput(stopAt), // blank → null → re-opens (running)
      });
    } else if (manual) {
      const s = fromLocalInput(startAt), e = fromLocalInput(stopAt);
      if (s === null || e === null || e < s) return;
      onAdd({ client: c, project: project.trim() || undefined, task: task.trim() || undefined, notes: notes.trim() || undefined, startedAt: s, stoppedAt: e });
    } else {
      onStart({ client: c, project: project.trim() || undefined, task: task.trim() || undefined, notes: notes.trim() || undefined });
    }
    onDone?.();
  };

  const field = "w-full px-2 py-1.5 bg-elevated border border-edge rounded text-sm focus:outline-none focus:border-edge-strong";
  const primary = accent ? "" : isEdit ? "bg-blue-600 hover:bg-blue-500" : "bg-green-600 hover:bg-green-500";

  return (
    <div className="space-y-2">
      <datalist id="ts-clients">{catalog.clientsActive.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <datalist id="ts-projects">{projectOptions.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <datalist id="ts-tasks">{catalog.tasksActive.map((t) => <option key={t.id} value={t.name} />)}</datalist>

      <div className="grid grid-cols-2 gap-2">
        <input list="ts-clients" className={field} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} autoFocus />
        <input list="ts-projects" className={field} placeholder="Project" value={project} onChange={(e) => setProject(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input list="ts-tasks" className={field} placeholder="Task (e.g. Programming)" value={task} onChange={(e) => setTask(e.target.value)} />
        <input className={field} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>

      {showTimes && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-dim">Start<input type="datetime-local" className={field} value={startAt} onChange={(e) => setStartAt(e.target.value)} /></label>
          <label className="text-xs text-dim">{isEdit ? "Stop (blank = running)" : "Stop"}<input type="datetime-local" className={field} value={stopAt} onChange={(e) => setStopAt(e.target.value)} /></label>
        </div>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        <button onClick={submit} disabled={!client.trim()} style={accentStyle}
          className={`px-3 py-1.5 rounded text-sm text-white disabled:opacity-40 ${primary}`}>
          {isEdit ? "Save" : manual ? "Add entry" : "Start timer"}
        </button>
        {!isEdit && (
          <button onClick={() => setManual((m) => !m)} className="px-2 py-1.5 text-xs text-dim hover:text-fg">
            {manual ? "Cancel" : "Add past entry"}
          </button>
        )}
        {isEdit && editEntry && onDelete && (
          <button onClick={() => { onDelete(editEntry.id); onDone?.(); }} className="ml-auto px-2.5 py-1.5 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
