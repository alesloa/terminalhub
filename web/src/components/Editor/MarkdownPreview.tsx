import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { languages } from "@codemirror/language-data";
import { api } from "../../api/client";
import type { FsFile } from "../../api/types";
import { useRoom } from "../../store/room";
import { useUi } from "../../store/ui";
import { getTheme } from "../../theme/themes";
import { hexToChannels } from "../../theme/applyTheme";
import { MarkdownTintControl } from "./MarkdownTintControl";
import { MarkdownReader } from "./MarkdownReader";

// Scale a theme token's hex down/up by a percentage, returning space-separated RGB channels for a
// `rgb(var(--tr-*))` override. Reuses hexToChannels so the parse matches applyTheme exactly.
function scaleChannels(hex: string, percent: number): string {
  const f = percent / 100;
  return hexToChannels(hex)
    .split(" ")
    .map(n => Math.max(0, Math.min(255, Math.round(Number(n) * f))))
    .join(" ");
}

// Some dark themes ship a link color too dark to read on a near-black page. Lift it so its brightest
// channel reaches a readable floor (preserves hue — all channels scale by the same factor — so the
// link still reads as its theme color, just bright enough), then apply the letter factor so links
// dim alongside the body text. Already-bright links pass through unchanged (save the letter factor).
const LINK_BRIGHTNESS_FLOOR = 210; // brightest channel target; bright enough to read on a dark bg
function readableLink(hex: string, textPercent: number): string {
  let [r, g, b] = hexToChannels(hex).split(" ").map(Number);
  const max = Math.max(r, g, b) || 1;
  if (max < LINK_BRIGHTNESS_FLOOR) { const k = LINK_BRIGHTNESS_FLOOR / max; r *= k; g *= k; b *= k; }
  const f = textPercent / 100;
  return [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n * f)))).join(" ");
}

const COLORS = [
  { label: "Blue", value: "rgb(var(--tr-link))" },
  { label: "Green", value: "#86efac" },
  { label: "Amber", value: "#fbbf24" },
  { label: "Rose", value: "#fda4af" },
  { label: "Violet", value: "#c4b5fd" },
  { label: "Gray", value: "rgb(var(--tr-text))" },
];

export function MarkdownPreview({ path, name }: { path: string; name: string }) {
  const liveContent = useRoom(s => s.documentContents[path]);
  const setDocumentContent = useRoom(s => s.setDocumentContent);
  const setDirty = useRoom(s => s.setDirty);
  const dirty = useRoom(s => s.dirtyFiles.has(path));
  const autoSave = useUi(s => s.autoSave);
  const autoSaveDelaySeconds = useUi(s => s.autoSaveDelaySeconds);
  const themeId = useUi(s => s.theme);
  const mdTextLevel = useUi(s => s.mdTextLevel);
  const mdBgLevel = useUi(s => s.mdBgLevel);
  const editorRef = useRef<MDXEditorMethods | null>(null);
  // Default to the read-only static renderer. It never chokes on real-world markdown (a stray
  // `<name>`, `List<T>`, a `<` comparison) the way the MDX editor does, and it keeps CPU flat on big
  // notes. The WYSIWYG editor is opt-in via the Edit toggle — that lossy, reformatting surface only
  // runs when the user explicitly asks to edit.
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [diskContent, setDiskContent] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "binary" | "toolarge" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const editorShellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (liveContent !== undefined) { setStatus("ready"); return; }
    let disposed = false;
    setStatus("loading");
    api.fsReadFile(path).then((file: FsFile) => {
      if (disposed) return;
      if (file.binary) { setStatus("binary"); return; }
      if (file.tooLarge) { setStatus("toolarge"); return; }
      const initial = file.content ?? "";
      setDiskContent(initial);
      setDocumentContent(path, initial);
      setStatus("ready");
    }).catch(() => { if (!disposed) setStatus("error"); });
    return () => { disposed = true; };
  }, [path, liveContent, setDocumentContent]);

  const content = liveContent ?? diskContent ?? "";

  useEffect(() => {
    const root = editorShellRef.current;
    if (!root) return;
    const applyTitles = () => {
      root.querySelectorAll<HTMLElement>("[aria-label]").forEach((el) => {
        const label = el.getAttribute("aria-label");
        if (label && !el.getAttribute("title")) el.setAttribute("title", label);
      });
    };
    applyTitles();
    const mo = new MutationObserver(applyTitles);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || liveContent === undefined) return;
    if (editor.getMarkdown() !== liveContent) editor.setMarkdown(liveContent);
  }, [liveContent]);

  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
    codeMirrorPlugin({ codeBlockLanguages: languages }),
    imagePlugin({ imageUploadHandler: readFileAsDataUrl }),
    diffSourcePlugin({ viewMode: "rich-text" }),
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper options={["rich-text", "source"]}>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <Separator />
          <BoldItalicUnderlineToggles />
          <StrikeThroughSupSubToggles options={["Strikethrough"]} />
          <CodeToggle />
          <Separator />
          <ListsToggle />
          <Separator />
          <CreateLink />
          <InsertImage />
          <InsertTable />
          <InsertCodeBlock />
          <InsertThematicBreak />
          <Separator />
        </DiffSourceToggleWrapper>
      ),
    }),
  ], []);

  const updateContent = (next: string, initialMarkdownNormalize = false) => {
    setDocumentContent(path, next);
    if (!initialMarkdownNormalize) setDirty(path, true);
  };

  const save = useCallback(async () => {
    const markdown = editorRef.current?.getMarkdown() ?? content;
    setSaving(true);
    try {
      await api.fsWriteFile(path, markdown);
      setDocumentContent(path, markdown);
      setDirty(path, false);
    } finally {
      setSaving(false);
    }
  }, [content, path, setDirty, setDocumentContent]);

  useEffect(() => {
    const root = editorShellRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [save]);

  useEffect(() => {
    if (!autoSave || !dirty || status !== "ready") return;
    const id = window.setTimeout(() => { void save(); }, autoSaveDelaySeconds * 1000);
    return () => window.clearTimeout(id);
  }, [autoSave, autoSaveDelaySeconds, content, dirty, save, status]);

  // Comfort tint: scope-override the theme color vars on the editor's scroll container. The MDXEditor
  // content reads --baseText/--basePageBg, which .tr-mdx-editor resolves from these --tr-* vars, and
  // the .tr-mdx-content rules read --tr-text/--tr-text-bright/--tr-code directly — so overriding the
  // vars here dims the letters and lifts/lowers the background for the document only, leaving the
  // header chrome and the rest of the app untouched. 100% = theme default (a no-op).
  useEffect(() => {
    const el = editorShellRef.current;
    if (!el || status !== "ready") return;
    const theme = getTheme(themeId);
    const t = theme.tokens;
    el.style.setProperty("--tr-text", scaleChannels(t.text, mdTextLevel));
    el.style.setProperty("--tr-text-bright", scaleChannels(t.textBright, mdTextLevel));
    for (const token of ["bg", "panel", "surface", "elevated", "code"] as const) {
      el.style.setProperty(`--tr-${token}`, scaleChannels(t[token], mdBgLevel));
    }
    // Keep links readable on dark themes (lift a too-dark link color); leave light themes alone, where
    // brightening a link would cut its contrast against the light page.
    if (theme.type === "dark") el.style.setProperty("--tr-link", readableLink(t.link, mdTextLevel));
    else el.style.removeProperty("--tr-link");
  }, [themeId, mdTextLevel, mdBgLevel, status]);

  const colorSelection = (color: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const selected = editor.getSelectionMarkdown();
    editor.insertMarkdown(`<span style="color:${color}">${selected || "colored text"}</span>`);
  };

  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    const images = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith("image/"));
    for (const file of images) {
      const dataUrl = await readFileAsDataUrl(file);
      editorRef.current?.insertMarkdown(`![${file.name.replace(/\.[^.]+$/, "") || "image"}](${dataUrl})`);
    }
  };

  if (status !== "ready") {
    const msg = status === "loading" ? "Loading Markdown editor..."
      : status === "binary" ? "Binary file cannot be edited as Markdown."
      : status === "toolarge" ? "File is too large to edit here."
      : "Could not read this file.";
    return <div className="h-full flex items-center justify-center text-dim text-sm">{msg}</div>;
  }

  return (
    <div
      className={`h-full min-h-0 flex flex-col bg-canvas ${dropActive ? "ring-2 ring-inset ring-blue-400/60" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDropActive(true); }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => { void onDrop(e); }}>
      <div className="shrink-0 flex items-center gap-3 border-b border-edge bg-code px-3 py-1.5">
        <div className="min-w-0 flex-1 truncate text-xs text-dim">{name}</div>

        {/* Read renders sanitized static HTML (markdown-it) — it never errors on a stray <tag>,
            generic, or comparison. Edit opt-in mounts the WYSIWYG editor. */}
        <div className="flex items-center rounded bg-surface p-0.5 text-xs">
          {(["read", "edit"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} title={m === "read" ? "Read (static, never errors)" : "Edit (rich text)"}
              className={`h-6 px-2.5 rounded capitalize ${mode === m ? "bg-elevated text-bright" : "text-muted hover:text-fg"}`}>
              {m}
            </button>
          ))}
        </div>

        {mode === "edit" && (
          <div className="flex items-center gap-1">
            {COLORS.map(color => (
              <button key={color.value} title={color.label} onClick={() => colorSelection(color.value)}
                className="w-4 h-4 rounded-full border border-white/20 hover:ring-2 hover:ring-blue-400/60"
                style={{ backgroundColor: color.value }} />
            ))}
          </div>
        )}
        <MarkdownTintControl />
        {(mode === "edit" || dirty) && (
          <button disabled={saving} onClick={() => void save()} title="Save Markdown (Ctrl/Cmd+S)"
            className="h-7 px-3 rounded bg-elevated text-xs text-bright hover:bg-edge disabled:opacity-60">
            {saving ? "Saving..." : "Save"}
          </button>
        )}
      </div>

      <div ref={editorShellRef} className="flex-1 min-h-0 overflow-auto bg-canvas">
        {mode === "read" ? (
          <MarkdownReader source={content} />
        ) : (
          <MDXEditor
            ref={editorRef}
            markdown={content}
            onChange={updateContent}
            plugins={plugins}
            className="tr-mdx-editor dark-theme"
            contentEditableClassName="tr-mdx-content"
          />
        )}
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
