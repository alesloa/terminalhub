import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import grapesjs, { type Editor, type BlockProperties } from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import { api } from "../../api/client";
import type { FsFile } from "../../api/types";
import { useRoom } from "../../store/room";
import { useToasts } from "../../store/toasts";

/**
 * The rich view for an .html file. HTML opens in the code editor first (the default); the open-book
 * button brings it here. Three modes:
 *
 *  - "preview" (default): a sandboxed iframe that renders the file faithfully — inline styles apply
 *    and scripts run, so a JS-rendered page (one whose body is built at runtime) shows in full, not
 *    just its static shell. Read-only, so it can never alter the file.
 *  - "design": a GrapesJS drag-and-drop builder (BSD-3-Clause) — drop blocks, drag to reorder, edit
 *    text, restyle. It owns its own component/CSS model, so on save it REWRITES the document (CSS is
 *    reformatted, scripts and unsupported markup are dropped). For that reason it never auto-saves —
 *    you Save explicitly, behind a warning. Best for simple or new pages, not script-driven apps.
 *  - code: "Edit as code" flips the tab back to the raw, lossless CodeMirror editor.
 *
 * The HTML lives in the shared room buffer so all three surfaces and the code tab stay in sync. Only
 * an explicit Save (or the code editor's own save) writes to disk — design edits stay in memory until
 * you choose to keep them.
 */

const FULL_DOC = /<html[\s>]/i;

// Script types the browser actually executes (vs. data blocks like application/json or templates).
const EXEC_SCRIPT_TYPES = new Set([
  "", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript", "module", "text/babel", "text/jsx",
]);

/** A page is "script-driven" when it ships executable JS (external, or non-empty inline). Such a page
 *  builds its DOM at runtime, so a static visual builder can only show an empty shell — Design refuses
 *  these and points at Preview / Edit as code. Data scripts (JSON / templates) don't count. */
function isScriptDriven(html: string): boolean {
  if (!html || !/<script[\s>]/i.test(html)) return false;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("script")).some((s) => {
    if (s.getAttribute("src")) return true;
    const type = (s.getAttribute("type") ?? "").toLowerCase().trim();
    return EXEC_SCRIPT_TYPES.has(type) && (s.textContent ?? "").trim().length > 0;
  });
}

/** The editable body + collected CSS to seed the builder from a file's HTML. */
function seedFrom(html: string): { body: string; css: string } {
  if (!FULL_DOC.test(html)) return { body: html, css: "" };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const css = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
  return { body: doc.body?.innerHTML ?? html, css };
}

/** Merge the builder's body HTML + CSS back into the original document, preserving head/scripts.
 *  All existing <style> tags are replaced by one managed <style id="gjs-css">. Fragments save flat. */
function buildDoc(original: string, body: string, css: string): string {
  if (!FULL_DOC.test(original)) return css ? `${body}\n<style>${css}</style>` : body;
  const doc = new DOMParser().parseFromString(original, "text/html");
  doc.querySelectorAll("style").forEach((s) => s.remove());
  if (css) {
    const st = doc.createElement("style");
    st.id = "gjs-css";
    st.textContent = css;
    doc.head.appendChild(st);
  }
  doc.body.innerHTML = body;
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

// The drop palette. Plain HTML/component content so saved markup stays clean and portable.
const BLOCKS: BlockProperties[] = [
  { id: "section", label: "Section", category: "Layout", content: `<section style="padding:40px 24px;"></section>` },
  {
    id: "row2", label: "2 Columns", category: "Layout",
    content: `<div style="display:flex;gap:16px;"><div style="flex:1;padding:12px;">Column</div><div style="flex:1;padding:12px;">Column</div></div>`,
  },
  { id: "heading", label: "Heading", category: "Basic", content: `<h2>Heading</h2>` },
  { id: "text", label: "Text", category: "Basic", content: `<p>Insert your text here.</p>` },
  {
    id: "button", label: "Button", category: "Basic",
    content: `<a data-gjs-type="link" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-family:sans-serif;">Button</a>`,
  },
  { id: "link", label: "Link", category: "Basic", content: `<a href="#">Link</a>` },
  { id: "image", label: "Image", category: "Basic", content: { type: "image" } },
  { id: "divider", label: "Divider", category: "Basic", content: `<hr style="border:none;border-top:1px solid #ccc;margin:16px 0;"/>` },
];

// Dark theming for the GrapesJS chrome so the builder blends with the app instead of a light slab.
const GJS_THEME = {
  "--gjs-primary-color": "#181b21",
  "--gjs-secondary-color": "#9aa4b2",
  "--gjs-tertiary-color": "#11131a",
  "--gjs-quaternary-color": "#3b82f6",
  "--gjs-font-color": "#c5ccd6",
  "--gjs-font-color-active": "#ffffff",
} as CSSProperties;

const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-modals";

export function HtmlEditor({ path, name }: { path: string; name: string }) {
  const liveContent = useRoom((s) => s.documentContents[path]); // raw HTML working buffer for this file
  const setDocumentContent = useRoom((s) => s.setDocumentContent);
  const setDirty = useRoom((s) => s.setDirty);
  const openAsCode = useRoom((s) => s.openAsCode);
  const push = useToasts((s) => s.push);

  const [disk, setDisk] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "design">("preview");
  const [status, setStatus] = useState<"loading" | "ready" | "binary" | "toolarge" | "error">("loading");
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const originalRef = useRef(""); // the file as loaded — its head/scripts are the merge shell
  const loaded = useRef(false);   // GrapesJS finished its initial render → real edits can flow out
  const edited = useRef(false);   // a real edit happened post-load (gates the in-memory buffer sync)
  const syncTimer = useRef<number | undefined>(undefined);

  const html = liveContent ?? disk ?? "";
  const scriptDriven = useMemo(() => isScriptDriven(html), [html]);

  // Load once per file: reuse the room buffer if present (round-trip from the code tab), else read
  // the file as text. An empty file opens as a blank page.
  useEffect(() => {
    if (liveContent !== undefined) { setStatus("ready"); return; }
    let disposed = false;
    setStatus("loading");
    api.fsReadFile(path).then((file: FsFile) => {
      if (disposed) return;
      if (file.binary) { setStatus("binary"); return; }
      if (file.tooLarge) { setStatus("toolarge"); return; }
      const initial = file.content ?? "";
      setDisk(initial);
      setDocumentContent(path, initial);
      setStatus("ready");
    }).catch(() => { if (!disposed) setStatus("error"); });
    return () => { disposed = true; };
  }, [path, liveContent, setDocumentContent]);

  // Push the canvas back into the shared buffer (IN MEMORY ONLY — never the disk), debounced. Gated
  // on a real post-load edit so GrapesJS's import normalisation can't churn an untouched file.
  const scheduleSync = useCallback(() => {
    if (loaded.current) edited.current = true;
    window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      const ed = editorRef.current;
      if (!ed || !loaded.current || !edited.current) return;
      setDocumentContent(path, buildDoc(originalRef.current, ed.getHtml(), ed.getCss() ?? ""));
      setDirty(path, true);
    }, 400);
  }, [path, setDocumentContent, setDirty]);

  // Spin up the builder only while in design mode (it's heavy, and must never touch the file in
  // preview). Reads `html` once as the seed; later edits flow through scheduleSync.
  useEffect(() => {
    if (mode !== "design" || scriptDriven || status !== "ready" || editorRef.current || !containerRef.current) return;
    const { body, css } = seedFrom(html);
    originalRef.current = html;
    const ed = grapesjs.init({
      container: containerRef.current,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      components: body || "",
      style: css,
      blockManager: { blocks: BLOCKS },
    });
    editorRef.current = ed;
    ed.on("load", () => { loaded.current = true; });
    ed.on("update", scheduleSync);
    return () => {
      window.clearTimeout(syncTimer.current);
      // Flush edits to the in-memory buffer before teardown so Preview / the code tab see them.
      if (edited.current) {
        setDocumentContent(path, buildDoc(originalRef.current, ed.getHtml(), ed.getCss() ?? ""));
        setDirty(path, true);
      }
      ed.destroy();
      editorRef.current = null;
      loaded.current = false;
      edited.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status]);

  // A background tab mounts the canvas at 0 height; refresh GrapesJS when it gets real size again.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let lastH = 0;
    const ro = new ResizeObserver(() => {
      const h = host.clientHeight;
      if (h > 0 && h !== lastH) { lastH = h; editorRef.current?.refresh(); }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [mode]);

  // Explicit Save — design mode only. Rewrites the document from the canvas (lossy by nature), so it
  // is never wired to auto-save: the user opts in every time.
  const saveDesign = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    const out = buildDoc(originalRef.current, ed.getHtml(), ed.getCss() ?? "");
    setSaving(true);
    try {
      await api.fsWriteFile(path, out);
      setDocumentContent(path, out);
      setDirty(path, false);
    } catch (e) {
      push((e as Error).message || "Could not save the file");
    } finally {
      setSaving(false);
    }
  }, [path, setDocumentContent, setDirty, push]);

  // Ctrl/Cmd+S saves in design mode (preview is read-only, nothing to save).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || mode !== "design" || scriptDriven) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveDesign(); }
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [mode, saveDesign]);

  if (status !== "ready") {
    const msg = status === "loading" ? "Loading HTML…"
      : status === "binary" ? "Binary file — can’t open as HTML."
      : status === "toolarge" ? "File is too large to open here."
      : "Could not open this file.";
    return <div className="h-full flex items-center justify-center text-dim text-sm">{msg}</div>;
  }

  const seg = (active: boolean) =>
    `h-6 px-2.5 rounded ${active ? "bg-edge text-bright" : "text-fg hover:text-bright"}`;

  return (
    <div ref={rootRef} className="h-full min-h-0 flex flex-col bg-canvas">
      <div className="shrink-0 flex items-center gap-2 border-b border-edge bg-code px-3 py-1">
        <div className="min-w-0 flex-1 truncate text-xs text-dim">{name}</div>
        <div className="flex items-center rounded bg-elevated p-0.5 text-xs">
          <button onClick={() => openAsCode({ path, name })} title="Edit the raw HTML in the code editor"
            className={seg(false)}>
            Edit as code
          </button>
          <button onClick={() => setMode("preview")} title="Render the page (read-only)" className={seg(mode === "preview")}>
            Preview
          </button>
          <button onClick={() => setMode("design")}
            title={scriptDriven ? "Page is built by JavaScript — the builder can’t edit it (use Preview / Edit as code)" : "Drag-and-drop builder (static pages)"}
            className={`${seg(mode === "design")} ${scriptDriven ? "opacity-60" : ""}`}>
            Design
          </button>
        </div>
        {mode === "design" && !scriptDriven && (
          <button disabled={saving} onClick={() => void saveDesign()} title="Save (Ctrl/Cmd+S) — rewrites the document"
            className="h-7 px-3 rounded bg-elevated text-xs text-bright hover:bg-edge disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      {mode === "preview" ? (
        <iframe title={name} srcDoc={html} sandbox={SANDBOX} className="flex-1 min-h-0 w-full bg-white" />
      ) : scriptDriven ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-8 text-center">
          <div className="max-w-md text-sm text-dim">
            <div className="mb-1 font-medium text-amber-300/90">Can’t edit this page in the builder</div>
            It’s built by JavaScript at runtime, so the drag-and-drop builder would only see an empty
            shell. Use <b className="text-fg">Preview</b> to view it, or <b className="text-fg">Edit as code</b> to
            change it. The builder is for plain static HTML pages.
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-edge bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300/90">
            Builder mode rewrites the whole document on Save — CSS is reformatted. Nothing is written
            until you click Save.
          </div>
          <div ref={containerRef} className="flex-1 min-h-0" style={GJS_THEME} />
        </>
      )}
    </div>
  );
}
