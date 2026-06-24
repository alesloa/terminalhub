import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { startPathDrag } from "../../lib/dragImage";
import { getFileIconUrl, getFolderIconUrl } from "../../lib/materialIcons";
import type { WinRect } from "../../store/ui";
import type { BrowserTarget } from "./BrowserTree";
import type { BrowserEdit, BrowserFs } from "./useBrowserFs";
import { listRef, type BrowserEntry } from "./listing";
import { refKey, sameRef, type Ref } from "./ref";

export type BrowserView = "list" | "icons";

export interface QuickLookOpts { google: boolean; webViewLink: string | null }

interface ListProps {
  currentRef: Ref;
  view: BrowserView;
  showHidden: boolean;
  fs: BrowserFs;
  editing: BrowserEdit | null;
  startEdit: (edit: BrowserEdit) => void;
  requestDelete: (targets: BrowserTarget[]) => void;
  onOpenDir: (ref: Ref) => void;
  // Double-click / Enter on a file: the parent routes it to the editor (text/code) or Quick Look.
  onOpenFile: (ref: Ref, name: string, origin: WinRect, opts: QuickLookOpts) => void;
  // Space on a file: always a Quick Look peek (never the editor).
  onQuickLook: (ref: Ref, name: string, origin: WinRect, opts: QuickLookOpts) => void;
  onContextMenu: (e: ReactMouseEvent, target: BrowserTarget | null, container: Ref) => void;
  onCommitEdit: (name: string) => void;
  onCancelEdit: () => void;
}

const rectOf = (el: HTMLElement): WinRect => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const hasFiles = (dt: DataTransfer) => Array.from(dt.types ?? []).includes("Files");

/**
 * The middle pane: the selected folder's contents (host or Drive) in either a vertical list or a
 * Finder-style icon grid. Single-click selects; double-click opens a folder or Quick Looks a file
 * (Google-native docs Quick Look as their exported PDF); Space Quick Looks the selected file; arrows
 * move the selection. Full file management — cut/copy/paste/duplicate/rename/delete/new, inline
 * editing, keyboard shortcuts (F2, ⌘/Ctrl C·X·V, Delete), cut items dim. Host rows drag out (full
 * path as text/plain) into a terminal; Drive rows don't (no host path). Dropping OS files uploads
 * into the folder under the cursor (host bytes, or per-file Drive upload).
 */
export function BrowserList({ currentRef, view, showHidden, fs, editing, startEdit, requestDelete, onOpenDir, onOpenFile, onQuickLook, onContextMenu, onCommitEdit, onCancelEdit }: ListProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["fb-list", refKey(currentRef), showHidden],
    queryFn: () => listRef(currentRef, showHidden),
    staleTime: 10_000,
    refetchInterval: 4000, // reflect files added/removed outside the app without a manual refresh
  });
  const entries: BrowserEntry[] = data ?? [];
  const [sel, setSel] = useState<string | null>(null); // refKey of the selected row
  const [dropTarget, setDropTarget] = useState<string | null>(null); // refKey, or "" for the pane
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const hostRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef<{ str: string; t: number }>({ str: "", t: 0 }); // OS-style type-to-select buffer

  // New selection context → clear selection and grab focus so Space/arrows/shortcuts work first-press.
  useEffect(() => { setSel(null); hostRef.current?.focus(); }, [refKey(currentRef)]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (e: BrowserEntry, el: HTMLElement) => {
    if (e.type === "dir") onOpenDir(e.ref);
    else onOpenFile(e.ref, e.name, rectOf(el), { google: e.google, webViewLink: e.webViewLink });
  };
  const targetOf = (e: BrowserEntry): BrowserTarget => ({ ref: e.ref, name: e.name, type: e.type, webViewLink: e.webViewLink, google: e.google });
  const byKey = (k: string | null) => entries.find((e) => refKey(e.ref) === k);
  // The inline new-item tile shows only when an active new-file/new-folder edit targets THIS folder.
  const newEditing = editing && editing.mode !== "rename" && sameRef(editing.container, currentRef) ? editing : null;

  const onKeyDown = (ev: ReactKeyboardEvent) => {
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && (ev.key === "c" || ev.key === "x" || ev.key === "v")) {
      ev.preventDefault();
      if (ev.key === "v") fs.paste(currentRef, showHidden);
      else { const cur = byKey(sel); if (cur) (ev.key === "c" ? fs.copy : fs.cut)([cur.ref]); }
      return;
    }
    if (!entries.length) return;
    const i = entries.findIndex((e) => refKey(e.ref) === sel);
    // Select by index and keep the row on screen (arrows + type-ahead both lacked scroll-into-view).
    const selectAt = (idx: number) => {
      const e = entries[idx];
      if (!e) return;
      const k = refKey(e.ref);
      setSel(k);
      rowRefs.current.get(k)?.scrollIntoView({ block: "nearest" });
    };
    if (ev.key === "ArrowDown") { ev.preventDefault(); selectAt(Math.min(entries.length - 1, i + 1)); return; }
    if (ev.key === "ArrowUp") { ev.preventDefault(); selectAt(Math.max(0, i - 1)); return; }
    // Type-ahead (OS file-manager behavior): a printable key jumps to the next item whose name starts
    // with what you typed. Distinct keys in quick succession build a prefix ("tr" → first "tr…");
    // the same letter repeated cycles through matches; an idle pause (>700ms) starts a fresh search.
    // Space is reserved for Quick Look, so it never feeds the buffer.
    if (ev.key.length === 1 && ev.key !== " " && !mod && !ev.altKey) {
      ev.preventDefault();
      const now = Date.now();
      const ta = typeahead.current;
      const ch = ev.key.toLowerCase();
      let buf: string, cycle = false;
      if (now - ta.t > 700) buf = ch;                                   // expired → new search
      else if (ta.str.length === 1 && ta.str === ch) { buf = ch; cycle = true; } // same letter → cycle
      else buf = ta.str + ch;                                           // growing prefix
      ta.str = buf; ta.t = now;
      const n = entries.length;
      const start = cycle ? i : -1; // cycle: search after the current row; prefix: from the top
      for (let off = 1; off <= n; off++) {
        const idx = (((start + off) % n) + n) % n;
        if (entries[idx].name.toLowerCase().startsWith(buf)) { selectAt(idx); break; }
      }
      return;
    }
    const cur = entries[i];
    if (!cur) return;
    const el = rowRefs.current.get(refKey(cur.ref));
    if (ev.key === " ") { ev.preventDefault(); if (cur.type === "file" && el) onQuickLook(cur.ref, cur.name, rectOf(el), { google: cur.google, webViewLink: cur.webViewLink }); return; }
    if (ev.key === "Enter" && el) { ev.preventDefault(); open(cur, el); return; }
    if (ev.key === "F2") { ev.preventDefault(); startEdit({ mode: "rename", ref: cur.ref, name: cur.name }); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); requestDelete([targetOf(cur)]); }
  };

  // Drop OS files into a folder ref (or the pane → the current ref). Internal path drags carry no
  // "Files" entry, so they pass through (a host row dragged out to a terminal isn't an upload).
  const dropProps = (container: Ref, key: string) => ({
    onDragOver: (e: ReactDragEvent) => { if (hasFiles(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDropTarget(key); } },
    onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
    onDrop: (e: ReactDragEvent) => { if (hasFiles(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); setDropTarget(null); fs.dropUpload(e.dataTransfer, container, showHidden); } },
  });

  const editInput = (initial: string, isFile: boolean) => (
    <EditInput initial={initial} selectStem={isFile} onCommit={onCommitEdit} onCancel={onCancelEdit} />
  );

  const body = () => {
    if (isLoading && !data) return <Centered>Loading…</Centered>;
    if (error) return <Centered>Couldn’t read this folder.</Centered>;
    if (!entries.length && !newEditing) return <Centered>Empty folder.</Centered>;

    const newTile = newEditing && (
      <Item view={view} icon={newEditing.mode === "new-folder" ? getFolderIconUrl("", false) : getFileIconUrl("untitled")} dim={false} dropping={false}>
        {editInput("", newEditing.mode === "new-file")}
      </Item>
    );

    return (
      <>
        {newTile}
        {entries.map((e) => {
          const k = refKey(e.ref);
          const renaming = editing?.mode === "rename" && sameRef(editing.ref, e.ref);
          const draggable = e.ref.kind === "host" && !renaming; // Drive rows have no host path to drag out
          return (
            <Item
              key={k} view={view} icon={e.type === "dir" ? getFolderIconUrl(e.name, false) : getFileIconUrl(e.name)}
              selected={sel === k} dim={fs.isCut(e.ref) || !e.readable} dropping={dropTarget === k}
              rowRef={(el) => { if (el) rowRefs.current.set(k, el); else rowRefs.current.delete(k); }}
              draggable={draggable}
              onDragStart={draggable ? (ev) => startPathDrag(ev, [(e.ref as Extract<Ref, { kind: "host" }>).path]) : undefined}
              onClick={() => setSel(k)}
              onDoubleClick={(ev) => open(e, ev.currentTarget)}
              onContextMenu={(ev) => { ev.stopPropagation(); setSel(k); onContextMenu(ev, targetOf(e), e.type === "dir" ? e.ref : currentRef); }}
              {...(e.type === "dir" ? dropProps(e.ref, k) : {})}>
              {renaming ? editInput(e.name, e.type === "file") : <span className={view === "icons" ? "w-full truncate text-center" : "truncate"}>{e.name}</span>}
            </Item>
          );
        })}
      </>
    );
  };

  return (
    <div
      ref={hostRef} tabIndex={0} onKeyDown={onKeyDown}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, null, currentRef); }}
      {...dropProps(currentRef, "")}
      className={`h-full overflow-auto outline-none focus:ring-1 focus:ring-inset focus:ring-edge-strong ${dropTarget === "" ? "ring-1 ring-inset ring-blue-500/60" : ""} ${
        view === "icons" ? "grid content-start gap-1 p-2" : "py-1"
      } text-sm`}
      style={view === "icons" ? { gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))" } : undefined}>
      {body()}
    </div>
  );
}

/** One row (list) or tile (icon grid). Shared so selection/drag/drop/menu handlers stay identical
 *  across both layouts — only the wrapper class and icon size differ. */
function Item({ view, icon, children, selected, dim, dropping, rowRef, ...handlers }: {
  view: BrowserView; icon?: string; children: React.ReactNode;
  selected?: boolean; dim?: boolean; dropping?: boolean;
  rowRef?: (el: HTMLElement | null) => void;
} & React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }) {
  const base = selected ? "bg-elevated" : "hover:bg-surface";
  const ring = dropping ? "ring-1 ring-inset ring-blue-500/70" : "";
  if (view === "icons") {
    return (
      <div ref={rowRef} {...handlers}
        className={`flex flex-col items-center gap-1 rounded p-2 cursor-default ${base} ${ring} ${dim ? "opacity-50" : ""}`}>
        <img src={icon} alt="" className="h-12 w-12 shrink-0" draggable={false} />
        {children}
      </div>
    );
  }
  return (
    <div ref={rowRef} {...handlers}
      className={`px-3 h-7 flex items-center gap-2 cursor-default ${base} ${ring} ${dim ? "opacity-50" : ""}`}>
      <img src={icon} alt="" className="w-4 h-4 shrink-0" draggable={false} />
      {children}
    </div>
  );
}

/** The inline text field for rename / new-item. Enter or blur commits; Esc cancels; the stem (name
 *  without extension) is preselected for files so the extension survives a quick retype. */
function EditInput({ initial, selectStem, onCommit, onCancel }:
  { initial: string; selectStem: boolean; onCommit: (name: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const commit = () => { if (done.current) return; done.current = true; onCommit(value); };
  const cancel = () => { if (done.current) return; done.current = true; onCancel(); };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    if (selectStem && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial, selectStem]);

  return (
    <input
      ref={ref} value={value} spellCheck={false} autoComplete="off"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); } }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      className="w-full min-w-0 rounded border border-blue-500 bg-canvas px-1 py-0.5 text-sm text-fg outline-none"
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="col-span-full h-full flex items-center justify-center text-dim text-sm">{children}</div>;
}
