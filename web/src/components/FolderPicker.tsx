import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { FsEntry, FsListing } from "../api/types";

type SortKey = "name" | "mtime" | "size";
import { getFileIconUrl, getFolderIconUrl } from "../lib/materialIcons";

/**
 * A proper folder browser, styled to match the File Browser. Navigate via the volume chips,
 * clickable breadcrumb, the ".." row, or double-clicking a folder. Single-click selects a folder;
 * "Use this folder" picks the selection, or the folder you're currently inside if nothing's
 * selected. Files show dimmed for context (you can't open a file as a workspace). "New Folder"
 * creates a directory in the current folder and selects it. Props are unchanged so callers
 * (NewWorkspaceModal) keep working.
 */
export function FolderPicker({ onPick, onCancel }: { onPick: (path: string) => void; onCancel: () => void }) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [volumes, setVolumes] = useState<{ name: string; path: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null); // selected folder path; null → use the current dir
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState(false); // drives the grow-in entrance
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const listEl = useRef<HTMLDivElement>(null);

  useEffect(() => { api.fsVolumes().then((r) => setVolumes(r.volumes)).catch(() => {}); }, []);
  useEffect(() => { go("/"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);

  const go = (path: string) => {
    setError(null); setSel(null); setCreating(false); setLoading(true);
    return api.fsList(path)
      .then((r) => { setListing(r); return r; })
      .catch((e) => { setError(String(e.message)); return null; })
      .finally(() => setLoading(false));
  };
  const refresh = () => (listing ? api.fsList(listing.path).then(setListing).catch(() => {}) : Promise.resolve());

  // Escape cancels; Enter uses the chosen folder. (NewWorkspaceModal suppresses its own Escape
  // while the picker is open, so the picker owns these keys.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (creating) return; // the inline input handles its own keys
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter" && listing) { e.preventDefault(); onPick(sel ?? listing.path); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, listing, sel, onCancel, onPick]);

  const chosen = sel ?? listing?.path ?? "";
  const chosenName = chosen === "/" ? "/" : chosen.split("/").filter(Boolean).pop() ?? "";
  // Folders-first is always preserved; the chosen key sorts WITHIN each group. Clicking the active
  // column flips direction; switching column picks a sensible default (A→Z for name, newest/largest
  // first for date/size). Name is a tiebreaker so equal dates/sizes stay stable and alphabetical.
  const cmp = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const byName = (a: FsEntry, b: FsEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return (a: FsEntry, b: FsEntry) => {
      const d = sortKey === "name" ? byName(a, b) : sortKey === "mtime" ? a.mtime - b.mtime : a.size - b.size;
      return (d || byName(a, b)) * dir;
    };
  }, [sortKey, sortDir]);
  const dirs = useMemo(() => (listing?.entries ?? []).filter((e) => e.type === "dir").sort(cmp), [listing, cmp]);
  const files = useMemo(() => (listing?.entries ?? []).filter((e) => e.type === "file").sort(cmp), [listing, cmp]);
  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); }
  };
  const onVolume = (vp: string) => !!listing && (listing.path === vp || listing.path.startsWith(vp === "/" ? "/" : vp + "/"));

  const join = (dir: string, name: string) => (dir === "/" ? "/" + name : dir + "/" + name);
  const commitNew = async (name: string) => {
    const n = name.trim();
    setCreating(false);
    if (!n || !listing) return;
    try {
      const r = await api.fsMkdir(join(listing.path, n));
      await refresh();
      setSel(r.path);
      requestAnimationFrame(() => listEl.current?.scrollTo({ top: listEl.current.scrollHeight }));
    } catch (e) { setError(String((e as Error).message)); }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog" aria-modal="true" aria-label="Choose a folder"
    >
      <div
        className={`flex w-[760px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-edge-strong bg-panel shadow-2xl origin-center transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${shown ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
        style={{ height: "min(600px, 85vh)" }}
      >
        {/* header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-600/15 text-blue-400">
            <OpenFolderIcon />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-tight text-bright">Choose a folder</h2>
            <p className="mt-0.5 text-xs text-muted">Browse to a folder, or make a new one.</p>
          </div>
          <button onClick={onCancel} aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim transition-colors hover:bg-surface hover:text-fg cursor-pointer">
            <CloseIcon />
          </button>
        </div>

        {/* volume chips */}
        {volumes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
            {volumes.map((v) => {
              const active = onVolume(v.path);
              return (
                <button key={v.path} onClick={() => go(v.path)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer ${active ? "bg-blue-600/15 text-blue-300" : "bg-surface text-muted hover:bg-elevated hover:text-fg"}`}>
                  <DiskIcon />{v.name}
                </button>
              );
            })}
          </div>
        )}

        {/* toolbar: up + breadcrumb + new folder */}
        <div className="flex items-center gap-2 px-5 pb-2.5">
          <button onClick={() => listing?.parent && go(listing.parent)} disabled={!listing?.parent}
            aria-label="Up one folder" title="Up one folder"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-surface hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed">
            <UpIcon />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-md border border-edge bg-surface px-2 py-1 text-xs">
            {crumbs(listing?.path ?? "/").map((c, i, arr) => (
              <span key={c.path} className="flex shrink-0 items-center">
                {i > 0 && <ChevronIcon />}
                <button onClick={() => go(c.path)}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-elevated cursor-pointer ${i === arr.length - 1 ? "text-bright" : "text-muted hover:text-fg"}`}>
                  {i === 0 ? <RootIcon /> : c.name}
                </button>
              </span>
            ))}
          </div>
          <button onClick={() => { setCreating(true); setError(null); }} disabled={!listing}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-edge bg-elevated px-2.5 py-1.5 text-xs text-fg transition-colors hover:bg-edge-strong disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
            <NewFolderIcon /> New Folder
          </button>
        </div>

        {error && <div className="px-5 pb-2 text-xs text-error">{error}</div>}

        {/* sort header — Finder-style clickable columns; folders stay grouped first */}
        {listing && (
          <div className="mx-5 mb-1 flex items-center gap-2 border-b border-edge/60 px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-dim">
            <SortBtn label="Name" k="name" active={sortKey} dir={sortDir} onSort={setSort} className="flex-1 min-w-0 justify-start pl-6" />
            <SortBtn label="Size" k="size" active={sortKey} dir={sortDir} onSort={setSort} className="w-16 justify-end" />
            <SortBtn label="Modified" k="mtime" active={sortKey} dir={sortDir} onSort={setSort} className="w-28 justify-end" />
          </div>
        )}

        {/* listing */}
        <div ref={listEl} className="mx-5 flex-1 overflow-auto rounded-lg border border-edge bg-canvas/40 py-1">
          {loading && !listing ? (
            <Centered><SpinnerIcon /> Loading…</Centered>
          ) : !listing ? (
            <Centered>Couldn’t read this folder.</Centered>
          ) : (
            <>
              {listing.parent && (
                <Row key={`up:${listing.path}`} idx={0} icon={getFolderIconUrl("", false)} fallback="📁" name=".. (up)"
                  onDoubleClick={() => go(listing.parent!)} onClick={() => go(listing.parent!)} muted />
              )}
              {creating && <NewFolderRow onCommit={commitNew} onCancel={() => setCreating(false)} />}
              {dirs.map((e, i) => (
                <Row key={e.path} idx={i + 1} icon={getFolderIconUrl(e.name, false)} fallback="📁" name={e.name}
                  selected={sel === e.path} disabled={!e.readable}
                  onClick={() => e.readable && setSel(e.path)}
                  onDoubleClick={() => e.readable && go(e.path)}
                  date={fmtDate(e.mtime)} dateTitle={fmtDateFull(e.mtime)} />
              ))}
              {files.map((e, i) => (
                <Row key={e.path} idx={dirs.length + i + 1} icon={getFileIconUrl(e.name)} fallback="📄" name={e.name} dim
                  size={fmtSize(e.size)} date={fmtDate(e.mtime)} dateTitle={fmtDateFull(e.mtime)} />
              ))}
              {!dirs.length && !files.length && !creating && (
                <Centered><EmptyIcon /> This folder is empty.</Centered>
              )}
            </>
          )}
        </div>

        {/* footer */}
        <div className="mt-3 flex items-center gap-3 border-t border-edge bg-surface/30 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-dim">{sel ? "Selected" : "Current folder"}</div>
            <div className="truncate font-mono text-xs text-fg" title={chosen}>{chosen || "—"}</div>
          </div>
          <button onClick={onCancel} title="Esc"
            className="rounded-lg px-3.5 py-2 text-sm text-muted transition-colors hover:bg-surface hover:text-fg cursor-pointer">
            Cancel
          </button>
          <button disabled={!listing} onClick={() => listing && onPick(sel ?? listing.path)} title="Enter"
            className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
            <CheckIcon />
            <span className="truncate">{sel ? `Use “${chosenName}”` : "Use this folder"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- pieces ---- */

/** Build clickable breadcrumb segments from a POSIX path. "/" → [/]; "/a/b" → [/, a, b]. */
function crumbs(path: string): { name: string; path: string }[] {
  const out = [{ name: "/", path: "/" }];
  let cur = "";
  for (const p of path.split("/").filter(Boolean)) { cur += "/" + p; out.push({ name: p, path: cur }); }
  return out;
}

function Row({ icon, fallback, name, onClick, onDoubleClick, selected, disabled, dim, muted, idx = 0, size, date, dateTitle }: {
  icon?: string; fallback: string; name: string;
  onClick?: () => void; onDoubleClick?: () => void;
  selected?: boolean; disabled?: boolean; dim?: boolean; muted?: boolean; idx?: number;
  size?: string; date?: string; dateTitle?: string;
}) {
  const interactive = !!onClick || !!onDoubleClick;
  const base = selected ? "bg-blue-600/15 text-bright" : interactive && !disabled ? "hover:bg-surface" : "";
  // Staggered rise on mount (capped so a huge folder doesn't ripple forever). Selecting a row reuses
  // the same DOM node (stable key), so it never replays.
  const delay = Math.min(idx, 14) * 14;
  const meta = size !== undefined || date !== undefined; // ".. (up)" passes neither → no meta columns
  return (
    <div onClick={disabled ? undefined : onClick} onDoubleClick={disabled ? undefined : onDoubleClick}
      style={{ animation: "tr-rise .18s ease-out both", animationDelay: `${delay}ms` }}
      className={`relative flex h-7 items-center gap-2 pl-3 pr-3 text-sm ${base} ${dim ? "opacity-40" : disabled ? "opacity-40 cursor-not-allowed" : interactive ? "cursor-pointer" : ""} ${muted ? "text-muted" : ""}`}>
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-blue-500" />}
      {icon ? <img src={icon} alt="" className="h-4 w-4 shrink-0" draggable={false} />
        : <span className="w-4 shrink-0 text-center">{fallback}</span>}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {meta && (
        <>
          <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-dim">{size ?? ""}</span>
          <span title={dateTitle} className="w-28 shrink-0 text-right text-[11px] tabular-nums text-dim">{date ?? ""}</span>
        </>
      )}
    </div>
  );
}

/** A clickable sort-column header. Shows ▲/▼ on the active column; clicking it again flips direction. */
function SortBtn({ label, k, active, dir, onSort, className = "" }: {
  label: string; k: SortKey; active: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; className?: string;
}) {
  const on = active === k;
  return (
    <button onClick={() => onSort(k)}
      className={`inline-flex items-center gap-1 rounded transition-colors hover:text-fg cursor-pointer ${on ? "text-fg" : ""} ${className}`}>
      <span className="truncate">{label}</span>
      {on && <span className="text-[8px] leading-none">{dir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

/** Human file size: "0 B", "4.2 KB", "13 MB". Folders pass no size, so this only runs for files. */
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** Compact modified date for the row ("Jun 22, 2026"); 0 (unknown mtime) renders nothing. */
function fmtDate(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

/** Full date+time for the row's hover tooltip. */
function fmtDateFull(ms: number): string {
  return ms ? new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
}

/** Inline input row for "New Folder". Enter / blur commits; Esc cancels. */
function NewFolderRow({ onCommit, onCancel }: { onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const done = useRef(false);
  const commit = () => { if (done.current) return; done.current = true; onCommit(value); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex h-7 items-center gap-2 px-3 text-sm">
      <span className="w-4 shrink-0 text-center">📁</span>
      <input ref={ref} value={value} spellCheck={false} autoComplete="off" placeholder="New folder name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); } }}
        onBlur={commit}
        className="w-full min-w-0 rounded border border-blue-500 bg-canvas px-1 py-0.5 text-sm text-fg outline-none" />
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-dim">{children}</div>;
}

/* ---- icons (matching NewWorkspaceModal's inline-SVG convention) ---- */

const sv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function OpenFolderIcon() {
  return (
    <svg width="18" height="18" {...sv}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v1.5" />
      <path d="M3 10.5h16.5a1 1 0 0 1 .96 1.28l-1.6 5.5a1.5 1.5 0 0 1-1.44 1.07H4.5A1.5 1.5 0 0 1 3 17.85z" />
    </svg>
  );
}
function NewFolderIcon() {
  return <svg width="14" height="14" {...sv}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" /><path d="M12 11v5M9.5 13.5h5" /></svg>;
}
function UpIcon() {
  return <svg width="16" height="16" {...sv}><path d="M12 19V6M6 12l6-6 6 6" /></svg>;
}
function CloseIcon() {
  return <svg width="16" height="16" {...sv}><path d="M6 6l12 12M18 6 6 18" /></svg>;
}
function ChevronIcon() {
  return <svg width="12" height="12" className="shrink-0 text-dim" {...sv}><path d="m9 6 6 6-6 6" /></svg>;
}
function RootIcon() {
  return <svg width="13" height="13" {...sv}><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10.5V19h12v-8.5" /></svg>;
}
function DiskIcon() {
  return <svg width="12" height="12" {...sv}><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17" /><circle cx="7.5" cy="14.5" r="1" /></svg>;
}
function CheckIcon() {
  return <svg width="14" height="14" className="shrink-0" {...sv}><path d="m5 12.5 4.5 4.5L19 7" /></svg>;
}
function EmptyIcon() {
  return <svg width="28" height="28" className="text-edge-strong" {...sv}><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" /></svg>;
}
function SpinnerIcon() {
  return (
    <svg width="16" height="16" className="shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
