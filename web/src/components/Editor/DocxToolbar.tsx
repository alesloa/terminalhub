import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { HexColorPicker } from "react-colorful";
import type { Editor } from "@tiptap/react";

/**
 * The Word-editor command bar. One row of grouped controls over a TipTap editor — text marks,
 * colors, fonts, alignment, lists, blocks, links, images, and tables — mirroring a Google-Docs /
 * Word ribbon. Stateless: every button reads/writes the live editor, and the bar re-renders on each
 * editor transaction so active states and enablement track the current selection.
 */

// Re-render on every editor transaction (selection move or content change) so isActive()/can() are current.
function useEditorTick(editor: Editor) {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    const fn = () => force();
    editor.on("transaction", fn);
    return () => { editor.off("transaction", fn); };
  }, [editor]);
}

// Text + highlight palettes. Plain hex so they serialize cleanly into the .docx round-trip (no theme vars).
const TEXT_COLORS = ["#e6e6e6", "#000000", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];
const HIGHLIGHT_COLORS = ["#fef08a", "#bbf7d0", "#bae6fd", "#fbcfe8", "#fed7aa", "#e9d5ff"];

const FONTS = [
  { label: "Font", value: "" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
];

const SIZES = [
  { label: "Size", value: "" },
  ...[10, 11, 12, 14, 16, 18, 24, 30, 36, 48].map((n) => ({ label: String(n), value: `${n}px` })),
];

export function DocxToolbar({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const chain = () => editor.chain().focus();
  const ts = editor.getAttributes("textStyle"); // current text-style mark (color / fontFamily / fontSize)

  const blockValue = editor.isActive("heading", { level: 1 }) ? "h1"
    : editor.isActive("heading", { level: 2 }) ? "h2"
    : editor.isActive("heading", { level: 3 }) ? "h3"
    : editor.isActive("heading", { level: 4 }) ? "h4"
    : editor.isActive("heading", { level: 5 }) ? "h5"
    : editor.isActive("heading", { level: 6 }) ? "h6"
    : "p";

  const setBlock = (v: string) => {
    if (v === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  };

  const promptLink = () => {
    const prev = (editor.getAttributes("link").href as string) ?? "";
    const url = window.prompt("Link URL (empty to remove)", prev);
    if (url === null) return;
    if (url === "") { chain().extendMarkRange("link").unsetLink().run(); return; }
    chain().extendMarkRange("link").setLink({ href: url }).run();
  };

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => chain().setImage({ src: String(reader.result ?? "") }).run();
    reader.readAsDataURL(file);
  };

  const inTable = editor.isActive("table");

  return (
    <div className="shrink-0 flex flex-wrap items-center gap-0.5 border-b border-edge bg-code px-2 py-1">
      <Btn title="Undo (Ctrl/Cmd+Z)" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}><UndoIcon /></Btn>
      <Btn title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}><RedoIcon /></Btn>
      <Sep />

      <Select title="Paragraph style" value={blockValue} onChange={setBlock} width="5.5rem"
        options={[
          { label: "Normal", value: "p" },
          { label: "Heading 1", value: "h1" }, { label: "Heading 2", value: "h2" }, { label: "Heading 3", value: "h3" },
          { label: "Heading 4", value: "h4" }, { label: "Heading 5", value: "h5" }, { label: "Heading 6", value: "h6" },
        ]} />
      <Select title="Font" value={(ts.fontFamily as string) ?? ""} width="6.5rem" options={FONTS}
        onChange={(v) => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run())} />
      <Select title="Font size" value={(ts.fontSize as string) ?? ""} width="4rem" options={SIZES}
        onChange={(v) => (v ? chain().setFontSize(v).run() : chain().unsetFontSize().run())} />
      <Sep />

      <Btn title="Bold (Ctrl/Cmd+B)" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}><b>B</b></Btn>
      <Btn title="Italic (Ctrl/Cmd+I)" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}><i>I</i></Btn>
      <Btn title="Underline (Ctrl/Cmd+U)" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}><u>U</u></Btn>
      <Btn title="Strikethrough" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}><s>S</s></Btn>
      <Btn title="Inline code" active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}><CodeIcon /></Btn>
      <Btn title="Superscript" active={editor.isActive("superscript")} onClick={() => chain().toggleSuperscript().run()}><span className="text-[11px]">x<sup>2</sup></span></Btn>
      <Btn title="Subscript" active={editor.isActive("subscript")} onClick={() => chain().toggleSubscript().run()}><span className="text-[11px]">x<sub>2</sub></span></Btn>
      <Sep />

      <ColorControl title="Text color" presets={TEXT_COLORS} current={(ts.color as string) ?? null}
        onPick={(c) => chain().setColor(c).run()} onClear={() => chain().unsetColor().run()} glyph={<span className="font-semibold">A</span>} />
      <ColorControl title="Highlight" presets={HIGHLIGHT_COLORS} current={(editor.getAttributes("highlight").color as string) ?? null}
        onPick={(c) => chain().setHighlight({ color: c }).run()} onClear={() => chain().unsetHighlight().run()} glyph={<HighlightIcon />} />
      <Sep />

      <Btn title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => chain().setTextAlign("left").run()}><AlignIcon a="l" /></Btn>
      <Btn title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => chain().setTextAlign("center").run()}><AlignIcon a="c" /></Btn>
      <Btn title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => chain().setTextAlign("right").run()}><AlignIcon a="r" /></Btn>
      <Btn title="Justify" active={editor.isActive({ textAlign: "justify" })} onClick={() => chain().setTextAlign("justify").run()}><AlignIcon a="j" /></Btn>
      <Sep />

      <Btn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}><BulletIcon /></Btn>
      <Btn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}><OrderedIcon /></Btn>
      <Btn title="Blockquote" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}><QuoteIcon /></Btn>
      <Btn title="Code block" active={editor.isActive("codeBlock")} onClick={() => chain().toggleCodeBlock().run()}><CodeBlockIcon /></Btn>
      <Btn title="Horizontal rule" onClick={() => chain().setHorizontalRule().run()}><RuleIcon /></Btn>
      <Sep />

      <Btn title="Link" active={editor.isActive("link")} onClick={promptLink}><LinkIcon /></Btn>
      <Btn title="Insert image" onClick={() => imageInputRef.current?.click()}><ImageIcon /></Btn>
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ""; }} />
      <Sep />

      <Btn title="Insert table" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon /></Btn>
      <Btn title="Add row below" disabled={!inTable} onClick={() => chain().addRowAfter().run()}><RowAddIcon /></Btn>
      <Btn title="Add column after" disabled={!inTable} onClick={() => chain().addColumnAfter().run()}><ColAddIcon /></Btn>
      <Btn title="Delete row" disabled={!inTable} onClick={() => chain().deleteRow().run()}><RowDelIcon /></Btn>
      <Btn title="Delete column" disabled={!inTable} onClick={() => chain().deleteColumn().run()}><ColDelIcon /></Btn>
      <Btn title="Delete table" disabled={!inTable} onClick={() => chain().deleteTable().run()}><TableDelIcon /></Btn>
      <Sep />

      <Btn title="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}><ClearIcon /></Btn>
    </div>
  );
}

function Btn({ title, active, disabled, onClick, children }:
  { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`grid h-7 min-w-7 px-1 place-items-center rounded text-xs leading-none transition-colors
        disabled:opacity-35 disabled:cursor-default
        ${active ? "bg-elevated text-bright" : "text-muted hover:bg-surface hover:text-fg"}`}>
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-edge" />;
}

function Select({ title, value, onChange, options, width }:
  { title: string; value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; width: string }) {
  return (
    <select title={title} aria-label={title} value={value} onChange={(e) => onChange(e.target.value)} style={{ width }}
      className="h-7 rounded bg-elevated px-1 text-xs text-fg hover:bg-edge focus:outline-none">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// Normalize whatever the editor reports (named colors, rgb(), short hex) to a 6-digit hex the
// spectrum picker can seed from. Falls back to a mid-grey when the value isn't a hex we recognize.
function toHex(value: string | null): string {
  if (!value) return "#888888";
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return "#" + value.slice(1).split("").map((c) => c + c).join("");
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return "#888888";
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// A glyph button (with an underline showing the active color) that opens a real color picker popover:
// a Photoshop-style saturation/value square + hue slider for any shade, a hex field for exact values,
// a few quick presets, and a clear. Click to open; outside-click or Escape closes. Dragging the
// spectrum updates the live swatch + hex; the editor mark is applied once on pointer release (so a
// drag is a single undo step, not hundreds).
function ColorControl({ title, presets, current, onPick, onClear, glyph }:
  { title: string; presets: string[]; current: string | null; onPick: (c: string) => void; onClear: () => void; glyph: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(toHex(current));
  const draftRef = useRef(draft);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const setDraftSafe = (c: string) => { draftRef.current = c; setDraft(c); };

  // Seed the picker from the current selection's color each time it opens.
  useEffect(() => { if (open) setDraftSafe(toHex(current)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey, true); };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" title={title} aria-label={title} onClick={() => setOpen((o) => !o)}
        className={`grid h-7 min-w-7 place-items-center rounded px-1 text-xs ${open ? "bg-elevated text-bright" : "text-muted hover:bg-surface hover:text-fg"}`}>
        <span className="flex flex-col items-center leading-none">
          <span>{glyph}</span>
          <span className="mt-0.5 h-1 w-4 rounded-sm border border-white/10" style={{ background: current ?? "transparent" }} />
        </span>
      </button>
      {open && (
        <div className="tr-docx-color absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-edge bg-elevated p-2.5 shadow-xl">
          {/* apply once on release so a drag is one undo step */}
          <div onPointerUp={() => onPick(draftRef.current)}>
            <HexColorPicker color={draft} onChange={setDraftSafe} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-6 w-6 shrink-0 rounded border border-white/20" style={{ background: draft }} />
            <input value={draft} spellCheck={false}
              onChange={(e) => { const v = e.target.value; setDraftSafe(v); if (HEX_RE.test(v)) onPick(v); }}
              className="h-7 w-full rounded bg-canvas px-2 font-mono text-xs text-fg outline-none focus:ring-1 focus:ring-blue-400/60" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {presets.map((c) => (
              <button key={c} type="button" title={c} onClick={() => { setDraftSafe(c); onPick(c); }}
                className="h-5 w-5 rounded border border-white/20 hover:ring-2 hover:ring-blue-400/60" style={{ background: c }} />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" onClick={() => { onClear(); setOpen(false); }}
              className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted hover:text-fg">None</button>
            <button type="button" onClick={() => setOpen(false)}
              className="rounded bg-surface px-2 py-0.5 text-[11px] text-muted hover:text-fg">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- icons (16px, stroke=currentColor) ---
const S = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const UndoIcon = () => <svg {...S}><path d="M3 8h7a3 3 0 010 6H7M3 8l3-3M3 8l3 3" /></svg>;
const RedoIcon = () => <svg {...S}><path d="M13 8H6a3 3 0 000 6h3M13 8l-3-3M13 8l-3 3" /></svg>;
const CodeIcon = () => <svg {...S}><path d="M6 5L2.5 8 6 11M10 5l3.5 3L10 11" /></svg>;
const HighlightIcon = () => <svg {...S} strokeWidth={1.3}><path d="M4 11l5-5 1.5 1.5-5 5H4z" /><path d="M9 6l2-2 1.5 1.5-2 2" /><path d="M3 14h10" /></svg>;
const BulletIcon = () => <svg {...S}><circle cx="3" cy="4.5" r="1" fill="currentColor" stroke="none" /><circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="3" cy="11.5" r="1" fill="currentColor" stroke="none" /><path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" /></svg>;
const OrderedIcon = () => <svg {...S}><path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" /><path d="M2 3.5h1V6M2 6h2" strokeWidth={1.1} /><path d="M2 10c0-.6 1.6-.6 1.6.2C3.6 11 2 11 2 12h2" strokeWidth={1.1} /></svg>;
const QuoteIcon = () => <svg {...S}><path d="M4 6h3v3a2 2 0 01-2 2M9 6h3v3a2 2 0 01-2 2" /></svg>;
const CodeBlockIcon = () => <svg {...S}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M6 6.5L4.5 8 6 9.5M10 6.5L11.5 8 10 9.5" strokeWidth={1.1} /></svg>;
const RuleIcon = () => <svg {...S}><path d="M2 8h12" /></svg>;
const LinkIcon = () => <svg {...S}><path d="M6.5 9.5l3-3M7 5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11l-1 1A2.5 2.5 0 014.5 8.5l1-1" /></svg>;
const ImageIcon = () => <svg {...S}><rect x="2" y="3" width="12" height="10" rx="1.5" /><circle cx="5.5" cy="6.5" r="1" /><path d="M3 12l3-3 2 2 2.5-2.5L13 11" /></svg>;
const TableIcon = () => <svg {...S}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 6.5h12M2 9.8h12M6 3v10M10 3v10" strokeWidth={1.1} /></svg>;
const RowAddIcon = () => <svg {...S}><rect x="2.5" y="2.5" width="11" height="4" rx="1" /><path d="M8 9v4M6 11h4" /></svg>;
const ColAddIcon = () => <svg {...S}><rect x="2.5" y="2.5" width="4" height="11" rx="1" /><path d="M11 6v4M9 8h4" /></svg>;
const RowDelIcon = () => <svg {...S}><rect x="2.5" y="2.5" width="11" height="4" rx="1" /><path d="M6 11h4" /></svg>;
const ColDelIcon = () => <svg {...S}><rect x="2.5" y="2.5" width="4" height="11" rx="1" /><path d="M9 8h4" /></svg>;
const TableDelIcon = () => <svg {...S}><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M5.5 6.5l5 5M10.5 6.5l-5 5" strokeWidth={1.1} /></svg>;
const ClearIcon = () => <svg {...S}><path d="M5 4h8M9 4l-2 9M3 13h5" /><path d="M11 10l3 3M14 10l-3 3" strokeWidth={1.1} /></svg>;

function AlignIcon({ a }: { a: "l" | "c" | "r" | "j" }) {
  const lines: Record<string, string> = {
    l: "M2 4h12M2 7h8M2 10h10M2 13h7",
    c: "M2 4h12M4 7h8M3 10h10M4 13h8",
    r: "M2 4h12M6 7h8M4 10h10M7 13h7",
    j: "M2 4h12M2 7h12M2 10h12M2 13h12",
  };
  return <svg {...S}><path d={lines[a]} /></svg>;
}
