import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { useRoom } from "../../store/room";
import { useToasts } from "../../store/toasts";
import { base64ToBytes, bytesToBase64 } from "../../lib/bytes";
import { bakePdf, type PdfAnno } from "../../lib/pdfBake";
import { usePdfDoc, usePdfPageCanvases, useFitScale, type PdfSize } from "../../hooks/usePdfDoc";
import { SignaturePad } from "./SignaturePad";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Tool = "select" | "text" | "check" | "sign";

const TEXT_SIZE_R = 0.018;   // default font as a fraction of page height (~14pt on US Letter)
const CHECK_SIZE_R = 0.026;
const SIG_WR = 0.28;         // default signature width as a fraction of page width
const INK = "#15233b";       // pen-like dark blue-black for text + checks

/**
 * Fill & sign editor for a PDF. Renders each page with pdf.js onto a canvas, then floats an overlay
 * where you place draggable text boxes, checkmarks, and a hand-drawn signature. Everything lives as
 * an on-screen overlay until you press Save, which bakes the items into the document with pdf-lib
 * (purely additive — your existing content is never rewritten) and writes the new bytes back. It
 * NEVER auto-saves: the overlay is just a staging layer until you choose to burn it in.
 */
export default function PdfFillSign({ path, name }: { path: string; name: string }) {
  const setDirty = useRoom((s) => s.setDirty);
  const push = useToasts((s) => s.push);

  const [srcBytes, setSrcBytes] = useState<Uint8Array | null>(null);
  const [readStatus, setReadStatus] = useState<"loading" | "toolarge" | "error" | "ok">("loading");
  const [annos, setAnnos] = useState<PdfAnno[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [sig, setSig] = useState<{ src: string; w: number; h: number } | null>(null);
  const [padOpen, setPadOpen] = useState(false);
  const [userScale, setUserScale] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const idc = useRef(0);
  const focusId = useRef<string | null>(null); // a freshly added text box auto-focuses on mount

  const nid = () => `pf${idc.current++}`;
  const markDirty = useCallback(() => setDirty(path, true), [setDirty, path]);

  // pdf.js load + per-page render live in shared hooks (one source of truth with the dark reader).
  const { pdf, pageSizes, status: docStatus } = usePdfDoc(srcBytes);
  const maxPw = useMemo(() => pageSizes.reduce((m, p) => Math.max(m, p.w), 0) || 612, [pageSizes]);
  const fitScale = useFitScale(containerRef, maxPw);
  const scale = userScale ?? fitScale;
  const setCanvas = usePdfPageCanvases(pdf, pageSizes, scale);

  // Read the file's bytes once per path (re-keyed only by path; a Save updates srcBytes directly).
  useEffect(() => {
    let disposed = false;
    setReadStatus("loading");
    api.fsReadFileBytes(path).then((f) => {
      if (disposed) return;
      if (f.tooLarge) { setReadStatus("toolarge"); return; }
      if (!f.dataBase64) { setReadStatus("error"); return; }
      setSrcBytes(base64ToBytes(f.dataBase64));
      setReadStatus("ok");
    }).catch(() => { if (!disposed) setReadStatus("error"); });
    return () => { disposed = true; };
  }, [path]);

  const update = useCallback((id: string, patch: Partial<PdfAnno>) => {
    setAnnos((prev) => prev.map((a) => (a.id === id ? ({ ...a, ...patch } as PdfAnno) : a)));
    markDirty();
  }, [markDirty]);

  const remove = useCallback((id: string) => {
    setAnnos((prev) => prev.filter((a) => a.id !== id));
    setSelected((s) => (s === id ? null : s));
    markDirty();
  }, [markDirty]);

  // Drag any annotation by recomputing its top-left ratio from the live overlay rect (robust to scroll).
  const beginDrag = useCallback((e: React.PointerEvent, a: PdfAnno) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(a.id);
    rootRef.current?.focus(); // so Delete / Cmd-S land after grabbing an item
    const overlay = (e.currentTarget as HTMLElement).closest("[data-page-overlay]") as HTMLElement | null;
    if (!overlay) return;
    const start = overlay.getBoundingClientRect();
    const offX = e.clientX - (start.left + a.xr * start.width);
    const offY = e.clientY - (start.top + a.yr * start.height);
    const onMove = (ev: PointerEvent) => {
      const r = overlay.getBoundingClientRect();
      update(a.id, {
        xr: clamp((ev.clientX - offX - r.left) / r.width, 0, 1),
        yr: clamp((ev.clientY - offY - r.top) / r.height, 0, 1),
      });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [update]);

  // Click on empty page space with a placing tool active → drop a new annotation there.
  const onPageDown = (e: React.PointerEvent<HTMLDivElement>, page: number) => {
    if (e.target !== e.currentTarget) return; // landed on an existing annotation, not the page
    if (tool === "select") { setSelected(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const xr = clamp((e.clientX - r.left) / r.width, 0, 1);
    const yr = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (tool === "text") {
      const id = nid();
      focusId.current = id;
      setAnnos((p) => [...p, { id, page, xr, yr, type: "text", text: "", sizeR: TEXT_SIZE_R, color: INK }]);
      setSelected(id);
      setTool("select");
    } else if (tool === "check") {
      const id = nid();
      setAnnos((p) => [...p, { id, page, xr, yr, type: "check", sizeR: CHECK_SIZE_R, color: INK }]);
      setSelected(id);
    } else if (tool === "sign") {
      if (!sig) { setPadOpen(true); return; }
      const pg = pageSizes[page];
      const hr = SIG_WR * (sig.h / sig.w) * (pg.w / pg.h);
      const id = nid();
      setAnnos((p) => [...p, { id, page, xr, yr, type: "sig", src: sig.src, wr: SIG_WR, hr }]);
      setSelected(id);
      setTool("select");
    }
    markDirty();
  };

  const save = useCallback(async () => {
    if (!srcBytes || annos.length === 0) return;
    setSaving(true);
    try {
      const out = await bakePdf(srcBytes, annos);
      await api.fsWriteFileBytes(path, bytesToBase64(out));
      setSelected(null);
      setAnnos([]);          // they're part of the document now — clear so a second Save can't double them
      setSrcBytes(out);      // re-renders the pages with the items burned in
      setDirty(path, false);
      push("Saved");
    } catch (e) {
      push((e as Error).message || "Could not save the PDF");
    } finally {
      setSaving(false);
    }
  }, [srcBytes, annos, path, setDirty, push]);

  // Delete the selection (unless typing in a text box); Cmd/Ctrl+S saves.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      const el = document.activeElement as HTMLElement | null;
      if (el?.isContentEditable) return;
      e.preventDefault();
      remove(selected);
    }
  };

  if (pageSizes.length === 0) {
    const msg = readStatus === "toolarge" ? "PDF is too large to edit here."
      : (readStatus === "error" || docStatus === "error") ? "Could not open this PDF."
      : "Loading PDF…";
    return <div className="h-full flex items-center justify-center text-dim text-sm">{msg}</div>;
  }

  return (
    <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}
      onPointerDown={(e) => { if (!(e.target as HTMLElement).isContentEditable) rootRef.current?.focus(); }}
      className="relative h-full min-h-0 flex flex-col bg-canvas outline-none">
      {/* tool row */}
      <div className="shrink-0 flex items-center gap-1.5 border-b border-edge bg-code px-3 py-1 text-xs">
        <ToolBtn active={tool === "select"} onClick={() => setTool("select")} title="Select / move">Select</ToolBtn>
        <ToolBtn active={tool === "text"} onClick={() => setTool("text")} title="Add a text box">Text</ToolBtn>
        <ToolBtn active={tool === "check"} onClick={() => setTool("check")} title="Add a checkmark">✓ Check</ToolBtn>
        <ToolBtn active={tool === "sign"} onClick={() => { setTool("sign"); if (!sig) setPadOpen(true); }} title="Place your signature">✍ Sign</ToolBtn>
        {sig && <button onClick={() => setPadOpen(true)} className="h-6 px-2 rounded text-dim hover:text-fg" title="Draw a new signature">Redraw</button>}
        <span className="mx-1 h-4 w-px bg-edge" />
        <button onClick={() => setUserScale(clamp(scale - 0.2, 0.3, 3))} className="h-6 w-6 rounded text-fg hover:bg-edge" title="Zoom out">−</button>
        <span className="w-10 text-center tabular-nums text-dim">{Math.round(scale * 100)}%</span>
        <button onClick={() => setUserScale(clamp(scale + 0.2, 0.3, 3))} className="h-6 w-6 rounded text-fg hover:bg-edge" title="Zoom in">+</button>
        <button onClick={() => setUserScale(null)} className="h-6 px-2 rounded text-dim hover:text-fg" title="Fit to width">Fit</button>
        <span className="flex-1" />
        <span className="truncate text-dim">{name}</span>
        <button disabled={saving || annos.length === 0} onClick={() => void save()}
          className="h-7 px-3 rounded bg-elevated text-bright hover:bg-edge disabled:opacity-50" title="Save (Ctrl/Cmd+S) — bake the edits into the PDF">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="shrink-0 border-b border-edge bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300/90">
        Pick a tool, then click the page to place it. Drag to reposition. Nothing is written until you Save.
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto bg-[#23262d] p-4">
        <div className="mx-auto flex flex-col items-center gap-4">
          {pageSizes.map((pg, i) => {
            const cssW = pg.w * scale, cssH = pg.h * scale;
            return (
              <div key={i} className="relative shadow-lg" style={{ width: cssW, height: cssH }}>
                <canvas
                  ref={(el) => setCanvas(i, el)}
                  style={{ width: cssW, height: cssH }}
                  className="absolute inset-0 block"
                />
                <div
                  data-page-overlay
                  onPointerDown={(e) => onPageDown(e, i)}
                  className="absolute inset-0"
                  style={{ cursor: tool === "select" ? "default" : "crosshair" }}>
                  {annos.filter((a) => a.page === i).map((a) => (
                    <AnnoView
                      key={a.id} a={a} pg={pg} scale={scale} selected={selected === a.id}
                      autoFocus={focusId.current === a.id}
                      onBeginDrag={beginDrag} onSelect={setSelected}
                      onText={(t) => update(a.id, { text: t })}
                      onResize={(dir) => resizeAnno(a, dir, update)}
                      onDelete={() => remove(a.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {padOpen && (
        <SignaturePad
          onClose={() => setPadOpen(false)}
          onDone={(src, w, h) => { setSig({ src, w, h }); setPadOpen(false); setTool("sign"); }}
        />
      )}
    </div>
  );
}

/** Grow/shrink an annotation a step, keeping signatures' aspect ratio. */
function resizeAnno(a: PdfAnno, dir: 1 | -1, update: (id: string, patch: Partial<PdfAnno>) => void) {
  if (a.type === "text") update(a.id, { sizeR: clamp(a.sizeR + dir * 0.004, 0.008, 0.08) });
  else if (a.type === "check") update(a.id, { sizeR: clamp(a.sizeR + dir * 0.006, 0.012, 0.06) });
  else {
    const f = dir > 0 ? 1.12 : 0.89;
    update(a.id, { wr: clamp(a.wr * f, 0.05, 0.95), hr: clamp(a.hr * f, 0.05, 0.95) });
  }
}

function ToolBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className={`h-6 px-2.5 rounded ${active ? "bg-elevated text-bright" : "text-fg hover:bg-edge"}`}>
      {children}
    </button>
  );
}

/** One annotation in the overlay, with its select/move/resize/delete chrome when active. */
function AnnoView({ a, pg, scale, selected, autoFocus, onBeginDrag, onSelect, onText, onResize, onDelete }: {
  a: PdfAnno; pg: PdfSize; scale: number; selected: boolean; autoFocus: boolean;
  onBeginDrag: (e: React.PointerEvent, a: PdfAnno) => void;
  onSelect: (id: string) => void;
  onText: (text: string) => void;
  onResize: (dir: 1 | -1) => void;
  onDelete: () => void;
}) {
  const editRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (a.type === "text" && autoFocus && editRef.current) editRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = { left: `${a.xr * 100}%`, top: `${a.yr * 100}%` } as const;
  const ring = selected ? "outline outline-1 outline-blue-400" : "";

  const bar = selected && (
    <div className="absolute -top-7 left-0 z-10 flex items-center gap-0.5 rounded border border-edge bg-elevated/95 px-1 py-0.5 text-[11px] text-fg shadow"
      onPointerDown={(e) => e.stopPropagation()}>
      <button className="px-1 cursor-grab" title="Move" onPointerDown={(e) => onBeginDrag(e, a)}>⠿</button>
      <button className="px-1 hover:text-bright" title="Smaller" onClick={() => onResize(-1)}>{a.type === "text" ? "A−" : "−"}</button>
      <button className="px-1 hover:text-bright" title="Bigger" onClick={() => onResize(1)}>{a.type === "text" ? "A+" : "+"}</button>
      <button className="px-1 text-red-300 hover:text-red-200" title="Delete" onClick={onDelete}>✕</button>
    </div>
  );

  if (a.type === "text") {
    const fontPx = a.sizeR * pg.h * scale;
    return (
      <div className={`absolute ${ring}`} style={pos} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}>
        {bar}
        <div
          ref={editRef}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => onText((e.target as HTMLDivElement).innerText)}
          onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id); }}
          className="whitespace-pre outline-none"
          style={{ fontSize: fontPx, color: a.color, lineHeight: 1.2, minWidth: Math.max(16, fontPx), fontFamily: "Helvetica, Arial, sans-serif" }}>
          {a.text}
        </div>
      </div>
    );
  }

  if (a.type === "check") {
    const s = a.sizeR * pg.h * scale;
    return (
      <div className={`absolute ${ring}`} style={pos} onPointerDown={(e) => onBeginDrag(e, a)}>
        {bar}
        <svg width={s} height={s} viewBox="0 0 100 100" className="block" style={{ pointerEvents: "none" }}>
          <polyline points="16,54 42,80 84,18" fill="none" stroke={a.color} strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  // signature
  const w = a.wr * pg.w * scale, h = a.hr * pg.h * scale;
  return (
    <div className={`absolute ${ring}`} style={pos} onPointerDown={(e) => onBeginDrag(e, a)}>
      {bar}
      <img src={a.src} alt="signature" draggable={false} style={{ width: w, height: h, pointerEvents: "none" }} className="block" />
    </div>
  );
}
