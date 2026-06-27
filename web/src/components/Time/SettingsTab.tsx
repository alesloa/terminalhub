import { useState } from "react";
import type { TimeCatalog } from "./useTimeCatalog";
import type { TimePrefs, TimeView } from "./prefs";

interface Props {
  catalog: TimeCatalog;
  prefs: TimePrefs;
  setPrefs: (patch: Partial<TimePrefs>) => void;
}

/** The widget's Settings tab: manage the Clients / Projects / Tasks catalog (the dropdown sources)
 *  and the appearance + view defaults. Catalog lives in the DB; appearance/view prefs are per-browser. */
export function SettingsTab({ catalog, prefs, setPrefs }: Props) {
  const [activeClient, setActiveClient] = useState<string | null>(null);
  const client = catalog.clients.find((c) => c.id === activeClient) ?? null;

  return (
    <div className="space-y-5">
      <Section title="Clients">
        <AddRow placeholder="Add a client…" onAdd={(n) => catalog.addClient(n)} />
        <List rows={catalog.clients.map((c) => ({ id: c.id, name: c.name, archived: c.archived }))}
          selectedId={activeClient}
          onSelect={(id) => setActiveClient(id === activeClient ? null : id)}
          onRename={(id, n) => catalog.renameClient(id, n)}
          onArchive={(id, a) => catalog.archiveClient(id, a)}
          onDelete={(id) => { catalog.removeClient(id); if (id === activeClient) setActiveClient(null); }}
          selectable />
      </Section>

      <Section title={client ? `Projects · ${client.name}` : "Projects"}>
        {!client
          ? <div className="text-xs text-dim">Select a client above to manage its projects.</div>
          : <>
            <AddRow placeholder={`Add a project for ${client.name}…`} onAdd={(n) => catalog.addProject(client.id, n)} />
            <List rows={catalog.projects.filter((p) => p.clientId === client.id).map((p) => ({ id: p.id, name: p.name, archived: p.archived }))}
              onRename={(id, n) => catalog.renameProject(id, n)}
              onArchive={(id, a) => catalog.archiveProject(id, a)}
              onDelete={(id) => catalog.removeProject(id)} />
          </>}
      </Section>

      <Section title="Tasks">
        <AddRow placeholder="Add a task type (e.g. Programming)…" onAdd={(n) => catalog.addTask(n)} />
        <List rows={catalog.tasks.map((t) => ({ id: t.id, name: t.name, archived: t.archived }))}
          onRename={(id, n) => catalog.renameTask(id, n)}
          onArchive={(id, a) => catalog.archiveTask(id, a)}
          onDelete={(id) => catalog.removeTask(id)} />
      </Section>

      <Section title="Appearance">
        <div className="space-y-3">
          <ColorRow label="Background" value={prefs.bg} onChange={(v) => setPrefs({ bg: v })} fallback="#0e0f12" />
          <ColorRow label="Accent" value={prefs.accent} onChange={(v) => setPrefs({ accent: v })} fallback="#f97316" />
          <Row label="Default view">
            <select value={prefs.defaultView} onChange={(e) => setPrefs({ defaultView: e.target.value as TimeView })}
              className="px-2 py-1 bg-elevated border border-edge rounded text-sm">
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="calendar">Calendar</option>
            </select>
          </Row>
          <Row label="Week starts">
            <select value={prefs.weekStart} onChange={(e) => setPrefs({ weekStart: Number(e.target.value) as 0 | 1 })}
              className="px-2 py-1 bg-elevated border border-edge rounded text-sm">
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </select>
          </Row>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-dim mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-sm">{label}</span>{children}</div>;
}

function ColorRow({ label, value, onChange, fallback }: { label: string; value: string | null; onChange: (v: string | null) => void; fallback: string }) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={value ?? fallback} onChange={(e) => onChange(e.target.value)} className="w-8 h-7 rounded bg-elevated border border-edge cursor-pointer" />
        {value && <button onClick={() => onChange(null)} className="text-xs text-dim hover:text-fg">Reset</button>}
      </div>
    </Row>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  const add = () => { const n = v.trim(); if (!n) return; onAdd(n); setV(""); };
  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={placeholder}
        className="flex-1 px-2 py-1 bg-elevated border border-edge rounded text-sm focus:outline-none focus:border-edge-strong" />
      <button onClick={add} disabled={!v.trim()} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-40">Add</button>
    </div>
  );
}

interface CatRow { id: string; name: string; archived: boolean }
function List({ rows, selectedId, onSelect, onRename, onArchive, onDelete, selectable }: {
  rows: CatRow[]; selectedId?: string | null; onSelect?: (id: string) => void;
  onRename: (id: string, name: string) => void; onArchive: (id: string, archived: boolean) => void; onDelete: (id: string) => void; selectable?: boolean;
}) {
  if (rows.length === 0) return <div className="text-xs text-dim">None yet.</div>;
  return (
    <div className="rounded border border-edge divide-y divide-surface">
      {rows.map((r) => (
        <CatItem key={r.id} row={r} selected={selectable && r.id === selectedId} onSelect={onSelect} onRename={onRename} onArchive={onArchive} onDelete={onDelete} />
      ))}
    </div>
  );
}

function CatItem({ row, selected, onSelect, onRename, onArchive, onDelete }: {
  row: CatRow; selected?: boolean; onSelect?: (id: string) => void;
  onRename: (id: string, name: string) => void; onArchive: (id: string, archived: boolean) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.name);
  const commit = () => { const n = name.trim(); if (n && n !== row.name) onRename(row.id, n); setEditing(false); };

  return (
    <div className={`group flex items-center gap-2 px-2 py-1.5 ${selected ? "bg-panel/50" : ""} ${row.archived ? "opacity-50" : ""}`}>
      {editing
        ? <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setName(row.name); setEditing(false); } }}
            className="flex-1 px-1.5 py-0.5 bg-elevated border border-edge rounded text-sm" />
        : <button onClick={() => onSelect?.(row.id)} className="flex-1 text-left text-sm truncate">
            {row.name}{row.archived && <span className="ml-2 text-xs text-dim">(archived)</span>}
          </button>}
      <button onClick={() => setEditing(true)} title="Rename" className="opacity-0 group-hover:opacity-100 text-dim hover:text-fg text-xs px-1">✎</button>
      <button onClick={() => onArchive(row.id, !row.archived)} title={row.archived ? "Unarchive" : "Archive"} className="opacity-0 group-hover:opacity-100 text-dim hover:text-fg text-xs px-1">{row.archived ? "↩" : "⊘"}</button>
      <button onClick={() => { if (confirm(`Delete "${row.name}"? Past entries keep the name.`)) onDelete(row.id); }} title="Delete" className="opacity-0 group-hover:opacity-100 text-dim hover:text-red-400 text-xs px-1">✕</button>
    </div>
  );
}
