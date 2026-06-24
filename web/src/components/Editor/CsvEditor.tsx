import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataGrid, { textEditor, type Column, type CellSelectArgs } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import Papa from "papaparse";
import { api } from "../../api/client";
import type { FsFile } from "../../api/types";
import { useRoom } from "../../store/room";
import { useUi } from "../../store/ui";

/**
 * A spreadsheet-style CSV/TSV editor. Every line is a data row and columns are labelled like a
 * spreadsheet (A, B, C…) — the file's own header line, if any, just shows as row 1. Cells edit in
 * place, columns drag to reorder, and the toolbar inserts/deletes rows and columns. The grid is the
 * source of truth while open; it serializes back to CSV on every change (into the room's live
 * buffer, so "Edit as code" sees the same content) and writes to disk on Save / auto-save.
 */

// Row objects are keyed by stable, opaque column ids (so reordering/inserting columns never
// disturbs the data already in a cell). __id keys the row for react-data-grid.
interface Row { __id: string; [colId: string]: string; }

// Process-wide monotonic id source for rows/columns. Plain counter — ids only need to be unique
// within a grid instance and stable across re-renders, not across reloads.
let _uid = 0;
const uid = (prefix: string) => `${prefix}${(_uid++).toString(36)}`;

// Spreadsheet column label: 0 → A, 25 → Z, 26 → AA, …
function colLabel(index: number): string {
  let s = "";
  let i = index + 1;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const ROWNUM_KEY = "__rownum";

function parseCsv(text: string, delimiter: string): { colIds: string[]; rows: Row[] } {
  const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  const matrix = (result.data as string[][]).filter(Boolean);
  const ncols = Math.max(1, ...matrix.map(r => r.length));
  const colIds = Array.from({ length: ncols }, () => uid("c"));
  const rows: Row[] = matrix.map(line => {
    const row: Row = { __id: uid("r") };
    colIds.forEach((id, i) => { row[id] = line[i] ?? ""; });
    return row;
  });
  if (rows.length === 0) {
    const row: Row = { __id: uid("r") };
    colIds.forEach(id => { row[id] = ""; });
    rows.push(row);
  }
  return { colIds, rows };
}

function serializeCsv(colIds: string[], rows: Row[], delimiter: string): string {
  const matrix = rows.map(r => colIds.map(id => r[id] ?? ""));
  return Papa.unparse(matrix, { delimiter });
}

export function CsvEditor({ path, name }: { path: string; name: string }) {
  const liveContent = useRoom(s => s.documentContents[path]);
  const setDocumentContent = useRoom(s => s.setDocumentContent);
  const setDirty = useRoom(s => s.setDirty);
  const dirty = useRoom(s => s.dirtyFiles.has(path));
  const openAsCode = useRoom(s => s.openAsCode);
  const autoSave = useUi(s => s.autoSave);
  const autoSaveDelaySeconds = useUi(s => s.autoSaveDelaySeconds);

  const delimiter = useMemo(() => (/\.tsv$/i.test(name) ? "\t" : ","), [name]);
  const [colIds, setColIds] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<{ rowIdx: number; colKey: string } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "binary" | "toolarge" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragRowIndex = useRef<number | null>(null);   // source row while dragging the gutter handle
  const [dropTarget, setDropTarget] = useState<number | null>(null); // row hovered during a row drag

  // Seed the grid once: prefer the room's live buffer (so a round-trip through "Edit as code"
  // reflects here), otherwise read from disk.
  useEffect(() => {
    if (liveContent !== undefined) {
      const { colIds, rows } = parseCsv(liveContent, delimiter);
      setColIds(colIds); setRows(rows); setStatus("ready");
      return;
    }
    let disposed = false;
    setStatus("loading");
    api.fsReadFile(path).then((file: FsFile) => {
      if (disposed) return;
      if (file.binary) { setStatus("binary"); return; }
      if (file.tooLarge) { setStatus("toolarge"); return; }
      const text = file.content ?? "";
      const { colIds, rows } = parseCsv(text, delimiter);
      setColIds(colIds); setRows(rows);
      setDocumentContent(path, text);
      setStatus("ready");
    }).catch(() => { if (!disposed) setStatus("error"); });
    return () => { disposed = true; };
    // Seed only on path change — later edits are driven by the grid, not re-parsed from the buffer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Push the current grid into the room's live buffer + mark dirty. Called after every mutation so
  // the code-editor view and auto-save always see the latest serialization.
  const pushBuffer = useCallback((ids: string[], rs: Row[]) => {
    setDocumentContent(path, serializeCsv(ids, rs, delimiter));
    setDirty(path, true);
  }, [path, delimiter, setDocumentContent, setDirty]);

  // Move a row to a new index. react-data-grid can't combine its column drag with row drag, so rows
  // reorder via the row-number gutter acting as a drag handle (see the rownum column below). Held in a
  // ref so the memoized column's drag handlers always call the current version without rebuilding columns.
  const reorderRow = (from: number, to: number) => {
    if (from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setRows(next); pushBuffer(colIds, next);
  };
  const reorderRef = useRef(reorderRow);
  reorderRef.current = reorderRow;

  // react-data-grid owns column dragging and would otherwise show only the header cell as the drag
  // image. We can't change that from its API, so we listen on the grid wrapper in the bubble phase
  // (runs AFTER RDG's own handler, so our setDragImage wins) and substitute a ghost of the WHOLE
  // column — header label + every cell's value — using the grid's own computed colors so it matches
  // the current theme exactly (no hardcoded palette).
  const onGridDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const header = (e.target as HTMLElement).closest('[role="columnheader"]') as HTMLElement | null;
    if (!header) return; // a row-handle drag — it sets its own image
    const ariaCol = Number(header.getAttribute("aria-colindex"));
    const colId = colIds[ariaCol - 2]; // -1 for 1-based, -1 for the frozen row-number column
    if (!colId) return;

    const grid = e.currentTarget;
    const sample = grid.querySelector(`[role="gridcell"][aria-colindex="${ariaCol}"]`) as HTMLElement | null;
    const headCs = getComputedStyle(header);
    const cellCs = sample ? getComputedStyle(sample) : headCs;
    const width = Math.round(header.getBoundingClientRect().width);

    const ghost = document.createElement("div");
    ghost.style.cssText = `position:fixed;top:-10000px;left:-10000px;width:${width}px;max-height:380px;overflow:hidden;border:1px solid ${cellCs.borderColor};border-radius:6px;box-shadow:0 10px 28px rgba(0,0,0,.5);font-size:${cellCs.fontSize};font-family:${cellCs.fontFamily};`;
    const head = document.createElement("div");
    head.textContent = header.textContent ?? "";
    head.style.cssText = `padding:6px 10px;font-weight:600;background:${headCs.backgroundColor};color:${headCs.color};`;
    ghost.appendChild(head);
    for (const r of rows) {
      const cell = document.createElement("div");
      cell.textContent = r[colId] ?? "";
      cell.style.cssText = `padding:5px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:${cellCs.backgroundColor};color:${cellCs.color};border-top:1px solid ${cellCs.borderColor};`;
      ghost.appendChild(cell);
    }
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, Math.round(e.clientX - header.getBoundingClientRect().left), 14);
    window.setTimeout(() => ghost.remove(), 0); // the snapshot is taken synchronously; drop the node
  };

  const columns = useMemo<Column<Row>[]>(() => {
    const rownum: Column<Row> = {
      key: ROWNUM_KEY, name: "", width: 52, minWidth: 52, frozen: true, resizable: false, draggable: false,
      cellClass: "tr-csv-rownum", headerCellClass: "tr-csv-rownum",
      // The gutter cell is a drag handle (grab the number) and a drop target (release on a row to land there).
      renderCell: ({ rowIdx }) => (
        <div className="tr-csv-grip" title="Drag to move row" draggable
          onDragStart={(e) => {
            dragRowIndex.current = rowIdx;
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", String(rowIdx)); } catch { /* some browsers require a set */ }
            // Drag the WHOLE row, not just the number: snapshot the row element as the drag image.
            const rowEl = (e.currentTarget as HTMLElement).closest('[role="row"]') as HTMLElement | null;
            if (rowEl) {
              const r = rowEl.getBoundingClientRect();
              e.dataTransfer.setDragImage(rowEl, e.clientX - r.left, e.clientY - r.top);
            }
          }}
          onDragEnter={() => { if (dragRowIndex.current !== null) setDropTarget(rowIdx); }}
          onDragOver={(e) => { if (dragRowIndex.current !== null) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragRowIndex.current !== null) reorderRef.current(dragRowIndex.current, rowIdx);
            dragRowIndex.current = null; setDropTarget(null);
          }}
          onDragEnd={() => { dragRowIndex.current = null; setDropTarget(null); }}>
          {rowIdx + 1}
        </div>
      ),
    };
    const data = colIds.map((id, i): Column<Row> => ({
      key: id, name: colLabel(i), width: 150, minWidth: 60,
      resizable: true, draggable: true, editable: true, renderEditCell: textEditor,
    }));
    return [rownum, ...data];
  }, [colIds]);

  const onRowsChange = useCallback((next: Row[]) => {
    setRows(next);
    pushBuffer(colIds, next);
  }, [colIds, pushBuffer]);

  const onColumnsReorder = useCallback((sourceKey: string, targetKey: string) => {
    if (sourceKey === ROWNUM_KEY || targetKey === ROWNUM_KEY) return;
    const from = colIds.indexOf(sourceKey);
    const to = colIds.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    const next = [...colIds];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setColIds(next);
    pushBuffer(next, rows);
  }, [colIds, rows, pushBuffer]);

  const dataColIndex = () => {
    const i = selected ? colIds.indexOf(selected.colKey) : -1;
    return i < 0 ? colIds.length - 1 : i;
  };

  // offset 0 = before the active column, 1 = after it (defaults to the last column).
  const insertColumn = (offset: 0 | 1) => {
    const id = uid("c");
    const at = Math.max(0, dataColIndex() + offset);
    const nextIds = [...colIds]; nextIds.splice(at, 0, id);
    const nextRows = rows.map(r => ({ ...r, [id]: "" }));
    setColIds(nextIds); setRows(nextRows); pushBuffer(nextIds, nextRows);
  };

  const deleteColumn = () => {
    if (colIds.length <= 1) return;
    const key = selected && selected.colKey !== ROWNUM_KEY ? selected.colKey : colIds[colIds.length - 1];
    const nextIds = colIds.filter(c => c !== key);
    const nextRows = rows.map(({ [key]: _drop, ...rest }) => rest as Row);
    setColIds(nextIds); setRows(nextRows); pushBuffer(nextIds, nextRows);
  };

  // offset 0 = above the active row, 1 = below it (defaults to the last row).
  const insertRow = (offset: 0 | 1) => {
    const blank: Row = { __id: uid("r") };
    colIds.forEach(id => { blank[id] = ""; });
    const baseIdx = selected ? selected.rowIdx : rows.length - 1;
    const at = Math.max(0, Math.min(rows.length, baseIdx + offset));
    const nextRows = [...rows]; nextRows.splice(at, 0, blank);
    setRows(nextRows); pushBuffer(colIds, nextRows);
  };

  const deleteRow = () => {
    if (rows.length <= 1) return;
    const idx = selected ? selected.rowIdx : rows.length - 1;
    if (idx < 0 || idx >= rows.length) return;
    const nextRows = rows.filter((_, i) => i !== idx);
    setRows(nextRows); pushBuffer(colIds, nextRows);
  };

  const save = useCallback(async () => {
    const csv = serializeCsv(colIds, rows, delimiter);
    setSaving(true);
    try {
      await api.fsWriteFile(path, csv);
      setDocumentContent(path, csv);
      setDirty(path, false);
    } finally {
      setSaving(false);
    }
  }, [colIds, rows, delimiter, path, setDirty, setDocumentContent]);

  // Ctrl/Cmd+S saves (scoped to this editor's shell so it doesn't fight other panes).
  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [save]);

  useEffect(() => {
    if (!autoSave || !dirty || status !== "ready") return;
    const id = window.setTimeout(() => { void save(); }, autoSaveDelaySeconds * 1000);
    return () => window.clearTimeout(id);
  }, [autoSave, autoSaveDelaySeconds, dirty, save, status, rows, colIds]);

  if (status !== "ready") {
    const msg = status === "loading" ? "Loading CSV…"
      : status === "binary" ? "Binary file cannot be opened as a table."
      : status === "toolarge" ? "File is too large to open as a table."
      : "Could not read this file.";
    return <div className="h-full flex items-center justify-center text-dim text-sm">{msg}</div>;
  }

  return (
    <div ref={shellRef} className="h-full min-h-0 flex flex-col bg-canvas">
      <div className="shrink-0 flex items-center gap-2 border-b border-edge bg-code px-3 py-1.5">
        <div className="min-w-0 flex-1 truncate text-xs text-dim">{name}</div>
        <div className="flex items-center gap-1">
          <ToolBtn title="Insert column before" onClick={() => insertColumn(0)}><ColBeforeIcon /></ToolBtn>
          <ToolBtn title="Insert column after" onClick={() => insertColumn(1)}><ColAfterIcon /></ToolBtn>
          <ToolBtn title="Delete column" onClick={deleteColumn}><ColDeleteIcon /></ToolBtn>
          <span className="mx-1 h-4 w-px bg-edge" />
          <ToolBtn title="Insert row above" onClick={() => insertRow(0)}><RowAboveIcon /></ToolBtn>
          <ToolBtn title="Insert row below" onClick={() => insertRow(1)}><RowBelowIcon /></ToolBtn>
          <ToolBtn title="Delete row" onClick={deleteRow}><RowDeleteIcon /></ToolBtn>
        </div>
        <button onClick={() => openAsCode({ path, name })} title="Edit as plain text (code editor)"
          className="h-7 px-2.5 rounded bg-elevated text-xs text-fg hover:bg-edge">
          Edit as code
        </button>
        <button disabled={saving} onClick={() => void save()} title="Save (Ctrl/Cmd+S)"
          className="h-7 px-3 rounded bg-elevated text-xs text-bright hover:bg-edge disabled:opacity-60">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="flex-1 min-h-0 tr-csv-grid" onDragStart={onGridDragStart}>
        <DataGrid
          className="rdg-dark"
          columns={columns}
          rows={rows}
          rowKeyGetter={(r) => r.__id}
          onRowsChange={onRowsChange}
          onColumnsReorder={onColumnsReorder}
          onSelectedCellChange={(args: CellSelectArgs<Row>) => setSelected({ rowIdx: args.rowIdx, colKey: args.column.key })}
          rowClass={(_row, rowIdx) => (rowIdx === dropTarget ? "tr-csv-drop" : undefined)}
          defaultColumnOptions={{ resizable: true }}
          style={{ blockSize: "100%" }}
        />
      </div>
    </div>
  );
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface hover:text-fg">
      {children}
    </button>
  );
}

// --- icons (16px, stroke=currentColor) ---
const S = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function ColBeforeIcon() {
  return <svg {...S}><rect x="8.5" y="2.5" width="5" height="11" rx="1" /><path d="M4 5.5v5M1.5 8h5" /></svg>;
}
function ColAfterIcon() {
  return <svg {...S}><rect x="2.5" y="2.5" width="5" height="11" rx="1" /><path d="M12 5.5v5M9.5 8h5" /></svg>;
}
function ColDeleteIcon() {
  return <svg {...S}><rect x="5.5" y="2.5" width="5" height="11" rx="1" /><path d="M2 13L4 11M2 11l2 2M12 13l2-2M12 11l2 2" /></svg>;
}
function RowAboveIcon() {
  return <svg {...S}><rect x="2.5" y="8.5" width="11" height="5" rx="1" /><path d="M8 4v-1.5M5.5 5l2.5-2.5L10.5 5" /></svg>;
}
function RowBelowIcon() {
  return <svg {...S}><rect x="2.5" y="2.5" width="11" height="5" rx="1" /><path d="M8 12v1.5M5.5 11l2.5 2.5L10.5 11" /></svg>;
}
function RowDeleteIcon() {
  return <svg {...S}><rect x="2.5" y="5.5" width="11" height="5" rx="1" /><path d="M2 3l2 2M4 3L2 5M12 3l2 2M14 3l-2 2" /></svg>;
}
