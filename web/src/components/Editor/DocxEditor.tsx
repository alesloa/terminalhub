import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Image } from "@tiptap/extension-image";
import mammoth from "mammoth/mammoth.browser.js";
import { api } from "../../api/client";
import { useRoom } from "../../store/room";
import { useUi } from "../../store/ui";
import { useToasts } from "../../store/toasts";
import { DocxToolbar } from "./DocxToolbar";
import { FileContextMenu, type FileMenuEntry } from "../Scm/FileContextMenu";

/**
 * A Word (.docx) rich-text editor. On open it reads the file's bytes (base64) and converts the
 * document to HTML with mammoth; the HTML drives a TipTap editor with a full formatting toolbar.
 * "Edit HTML" flips to a raw-HTML source view (the "code" side, since a .docx has no plain-text
 * form). Save posts the current HTML to the server, which renders a real .docx (html-to-docx runs on
 * Node) and writes it. The HTML lives in the room buffer so the two views and auto-save stay in sync.
 */

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Wrap the editor's body HTML in a minimal document so html-to-docx gets well-formed input.
const wrapHtml = (body: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;

export function DocxEditor({ path, name }: { path: string; name: string }) {
  const liveContent = useRoom((s) => s.documentContents[path]); // HTML working buffer for this file
  const setDocumentContent = useRoom((s) => s.setDocumentContent);
  const setDirty = useRoom((s) => s.setDirty);
  const dirty = useRoom((s) => s.dirtyFiles.has(path));
  const autoSave = useUi((s) => s.autoSave);
  const autoSaveDelaySeconds = useUi((s) => s.autoSaveDelaySeconds);
  const setSettings = useUi((s) => s.setSettings);
  const push = useToasts((s) => s.push);

  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<"rich" | "code">("rich");
  const [status, setStatus] = useState<"loading" | "ready" | "toolarge" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);
  const seeded = useRef(false); // suppress the dirty flag for the editor's own initial seed
  const shellRef = useRef<HTMLDivElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyleKit,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: true } }),
      Subscript,
      Superscript,
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content: "",
    editorProps: { attributes: { class: "tr-docx-content" } },
    onUpdate: ({ editor }) => {
      const h = editor.getHTML();
      setHtml(h);
      setDocumentContent(path, h);
      if (seeded.current) setDirty(path, true); // skip the seed transaction
    },
  });

  // Load once per file: reuse the room buffer if present (round-trip from the HTML view), else read
  // the .docx bytes and convert to HTML with mammoth. An empty file opens as a blank document.
  useEffect(() => {
    let disposed = false;
    if (liveContent !== undefined) { setHtml(liveContent); setStatus("ready"); return; }
    setStatus("loading");
    api.fsReadFileBytes(path).then(async (res) => {
      if (disposed) return;
      if (res.tooLarge) { setStatus("toolarge"); return; }
      if (!res.dataBase64 || res.size === 0) {
        setHtml(""); setDocumentContent(path, ""); setStatus("ready"); return;
      }
      const arrayBuffer = base64ToArrayBuffer(res.dataBase64);
      const { value } = await mammoth.convertToHtml({ arrayBuffer });
      if (disposed) return;
      setHtml(value); setDocumentContent(path, value); setStatus("ready");
    }).catch(() => { if (!disposed) setStatus("error"); });
    return () => { disposed = true; };
    // Seed only on path change; later edits flow through the editor, not a re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Push the loaded/buffered HTML into the editor once it's ready (without tripping the dirty flag).
  useEffect(() => {
    if (!editor || status !== "ready" || seeded.current) return;
    editor.commands.setContent(html || "<p></p>");
    seeded.current = true;
  }, [editor, status, html]);

  const enterCode = () => { if (editor) setHtml(editor.getHTML()); setMode("code"); };
  const enterRich = () => { editor?.commands.setContent(html || "<p></p>"); setMode("rich"); };

  const save = useCallback(async () => {
    const body = mode === "rich" ? (editor?.getHTML() ?? html) : html;
    setSaving(true);
    try {
      await api.fsWriteDocx(path, wrapHtml(body));
      setDirty(path, false);
    } catch (e) {
      push((e as Error).message || "Could not save the document");
    } finally {
      setSaving(false);
    }
  }, [editor, html, mode, path, setDirty, push]);

  // Ctrl/Cmd+S saves, scoped to this editor's shell.
  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [save]);

  useEffect(() => {
    if (!autoSave || !dirty || status !== "ready") return;
    const id = window.setTimeout(() => { void save(); }, autoSaveDelaySeconds * 1000);
    return () => window.clearTimeout(id);
  }, [autoSave, autoSaveDelaySeconds, dirty, save, status, html]);

  const onCodeChange = (next: string) => {
    setHtml(next);
    setDocumentContent(path, next);
    setDirty(path, true);
  };

  // Right-click inside a table cell → move the caret to that cell and open the table menu. Clicks
  // outside a table fall through to the browser's native menu.
  const onContextMenu = (e: ReactMouseEvent) => {
    if (!editor || !(e.target as HTMLElement).closest("td, th")) return;
    const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (pos) editor.chain().focus().setTextSelection(pos.pos).run();
    e.preventDefault();
    setTableMenu({ x: e.clientX, y: e.clientY });
  };

  const tableMenuItems = (): FileMenuEntry[] => {
    if (!editor) return [];
    const can = editor.can();
    const act = (fn: () => void): (() => void) => () => { fn(); setTableMenu(null); };
    const c = () => editor.chain().focus();
    return [
      { label: "Insert column before", onClick: act(() => c().addColumnBefore().run()) },
      { label: "Insert column after", onClick: act(() => c().addColumnAfter().run()) },
      { label: "Delete column", onClick: act(() => c().deleteColumn().run()) },
      "sep",
      { label: "Insert row above", onClick: act(() => c().addRowBefore().run()) },
      { label: "Insert row below", onClick: act(() => c().addRowAfter().run()) },
      { label: "Delete row", onClick: act(() => c().deleteRow().run()) },
      "sep",
      { label: "Merge cells", disabled: !can.mergeCells(), onClick: act(() => c().mergeCells().run()) },
      { label: "Split cell", disabled: !can.splitCell(), onClick: act(() => c().splitCell().run()) },
      "sep",
      { label: "Toggle header row", onClick: act(() => c().toggleHeaderRow().run()) },
      { label: "Toggle header column", onClick: act(() => c().toggleHeaderColumn().run()) },
      "sep",
      { label: "Delete table", onClick: act(() => c().deleteTable().run()) },
    ];
  };

  if (status !== "ready") {
    const msg = status === "loading" ? "Loading Word document…"
      : status === "toolarge" ? "File is too large to open here."
      : "Could not open this Word document.";
    return <div className="h-full flex items-center justify-center text-dim text-sm">{msg}</div>;
  }

  return (
    <div ref={shellRef} className="h-full min-h-0 flex flex-col bg-canvas">
      <div className="shrink-0 flex items-center gap-2 border-b border-edge bg-code px-3 py-1">
        <div className="min-w-0 flex-1 truncate text-xs text-dim">{name}</div>
        <button onClick={mode === "rich" ? enterCode : enterRich}
          title={mode === "rich" ? "Edit the underlying HTML" : "Back to the rich editor"}
          className="h-7 px-2.5 rounded bg-elevated text-xs text-fg hover:bg-edge">
          {mode === "rich" ? "Edit HTML" : "Rich editor"}
        </button>
        <label className="flex items-center gap-1.5 px-1 text-xs text-dim cursor-pointer select-none"
          title={`Auto-save changes after ${autoSaveDelaySeconds}s of quiet`}>
          <input type="checkbox" checked={autoSave} onChange={(e) => setSettings({ autoSave: e.target.checked })}
            className="accent-blue-500" />
          Auto-save
        </label>
        <button disabled={saving} onClick={() => void save()} title="Save (Ctrl/Cmd+S)"
          className="h-7 px-3 rounded bg-elevated text-xs text-bright hover:bg-edge disabled:opacity-60">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {mode === "rich" && editor && <DocxToolbar editor={editor} />}

      {mode === "rich" ? (
        <div className="flex-1 min-h-0 overflow-auto bg-canvas tr-docx-shell" onContextMenu={onContextMenu}>
          <EditorContent editor={editor} />
        </div>
      ) : (
        <textarea value={html} onChange={(e) => onCodeChange(e.target.value)} spellCheck={false}
          className="flex-1 min-h-0 w-full resize-none bg-canvas px-4 py-3 font-mono text-xs leading-relaxed text-fg outline-none" />
      )}

      {tableMenu && (
        <FileContextMenu x={tableMenu.x} y={tableMenu.y} items={tableMenuItems()} dismiss={() => setTableMenu(null)} />
      )}
    </div>
  );
}
