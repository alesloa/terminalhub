import { useState } from "react";
import type { TimeEntry } from "../../api/types";
import type { TimeCatalog } from "./useTimeCatalog";
import { entrySeconds, fmtClock, fmtHMS, fromLocalInput, toLocalInput } from "./util";

interface Props {
  entry: TimeEntry;
  now: number;
  catalog: TimeCatalog;
  onStop: (id: string) => void;
  onSave: (id: string, patch: Partial<Pick<TimeEntry, "client" | "project" | "task" | "notes" | "startedAt" | "stoppedAt">>) => void;
  onDelete: (id: string) => void;
}

/** One logged session. Shows client · project · task · notes + a live-ticking duration; running rows
 *  get a Stop button. The pencil opens an inline editor (fields + start/stop pickers, delete). */
export function EntryRow({ entry, now, catalog, onStop, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const running = entry.stoppedAt === null;

  if (editing) return <EntryEditor entry={entry} catalog={catalog} onClose={() => setEditing(false)} onSave={onSave} onDelete={onDelete} />;

  return (
    <div className="group flex items-center gap-3 px-3 py-2 border-b border-surface hover:bg-panel/40">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium truncate">{entry.client || "—"}</span>
          {entry.project && <span className="text-dim truncate">· {entry.project}</span>}
          {entry.task && <span className="px-1.5 py-0.5 rounded bg-elevated text-xs text-dim shrink-0">{entry.task}</span>}
        </div>
        <div className="text-xs text-dim truncate">
          {entry.notes && <span>{entry.notes} · </span>}
          {fmtClock(entry.startedAt)}–{running ? "now" : fmtClock(entry.stoppedAt!)}
        </div>
      </div>

      <div className={`tabular-nums text-sm ${running ? "text-green-400" : "text-fg"}`}>{fmtHMS(entrySeconds(entry, now))}</div>

      {running
        ? <button onClick={() => onStop(entry.id)} className="px-2 py-1 rounded bg-red-600/80 hover:bg-red-500 text-white text-xs">Stop</button>
        : <span className="w-9" />}
      <button onClick={() => setEditing(true)} title="Edit" className="opacity-0 group-hover:opacity-100 text-dim hover:text-fg text-sm px-1">✎</button>
      <button onClick={() => onDelete(entry.id)} title="Delete entry" className="opacity-0 group-hover:opacity-100 text-dim hover:text-red-400 text-sm px-1">✕</button>
    </div>
  );
}

function EntryEditor({ entry, catalog, onClose, onSave, onDelete }: {
  entry: TimeEntry; catalog: TimeCatalog; onClose: () => void;
  onSave: Props["onSave"]; onDelete: Props["onDelete"];
}) {
  const [client, setClient] = useState(entry.client);
  const [project, setProject] = useState(entry.project);
  const [task, setTask] = useState(entry.task);
  const [notes, setNotes] = useState(entry.notes);
  const [startAt, setStartAt] = useState(toLocalInput(entry.startedAt));
  const [stopAt, setStopAt] = useState(entry.stoppedAt === null ? "" : toLocalInput(entry.stoppedAt));
  const field = "w-full px-2 py-1 bg-elevated border border-edge rounded text-sm focus:outline-none focus:border-edge-strong";

  const save = () => {
    const s = fromLocalInput(startAt);
    onSave(entry.id, {
      client: client.trim(), project: project.trim(), task: task.trim(), notes: notes.trim(),
      ...(s !== null ? { startedAt: s } : {}),
      stoppedAt: fromLocalInput(stopAt), // empty → null → re-opens (running)
    });
    onClose();
  };

  return (
    <div className="px-3 py-2 border-b border-surface bg-panel/60 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <input className={field} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
        <input className={field} placeholder="Project" value={project} onChange={(e) => setProject(e.target.value)} />
        <input className={field} placeholder="Task" value={task} onChange={(e) => setTask(e.target.value)} />
      </div>
      <input className={field} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-dim">Start<input type="datetime-local" className={field} value={startAt} onChange={(e) => setStartAt(e.target.value)} /></label>
        <label className="text-xs text-dim">Stop (blank = running)<input type="datetime-local" className={field} value={stopAt} onChange={(e) => setStopAt(e.target.value)} /></label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs">Save</button>
        <button onClick={onClose} className="px-2 py-1 text-xs text-dim hover:text-fg">Cancel</button>
        <button onClick={() => { onDelete(entry.id); onClose(); }} className="ml-auto px-2 py-1 text-xs text-red-400 hover:text-red-300">Delete</button>
      </div>
    </div>
  );
}
