import { Component, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// MDXEditor (Lexical) throws on markup it can't parse — a stray `<name>`, `List<T>`, `a < b`. Catch
// that so a single odd note can't white-screen the panel; the parent flips to plain source editing.
class MdxBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/**
 * The Notes panel's rich (formatted) editor: the same MDXEditor + toolbar the IDE uses, but wired to
 * a note's content via plain props instead of the filesystem. Gives bold/italic, headings (font size),
 * lists, links, tables, images, and code blocks — a proper little notepad. `onChange`'s second arg is
 * MDXEditor's initial-normalize flag: true on the mount reformat (don't mark dirty), false on real
 * edits. Wrapped in an error boundary that falls back to source editing on unparseable markdown.
 * `editorRef` is forwarded to MDXEditor so the parent can inject dictated speech via insertMarkdown.
 */
export function NoteRichEditor({ markdown, onChange, onFail, editorRef }: {
  markdown: string;
  onChange: (md: string, initialNormalize: boolean) => void;
  onFail: () => void;
  editorRef: RefObject<MDXEditorMethods>;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);

  // Mirror the MDXEditor's aria-labels onto title attributes so the toolbar buttons get hover tooltips.
  useEffect(() => {
    const root = shellRef.current;
    if (!root) return;
    const apply = () => root.querySelectorAll<HTMLElement>("[aria-label]").forEach((el) => {
      const label = el.getAttribute("aria-label");
      if (label && !el.getAttribute("title")) el.setAttribute("title", label);
    });
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
    return () => mo.disconnect();
  }, []);

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
    markdownShortcutPlugin(),
    toolbarPlugin({
      toolbarContents: () => (
        <>
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
        </>
      ),
    }),
  ], []);

  return (
    <div ref={shellRef} className="flex-1 min-h-0 overflow-auto bg-canvas">
      <MdxBoundary onFail={onFail}>
        <MDXEditor ref={editorRef} markdown={markdown} onChange={onChange} plugins={plugins}
          className="tr-mdx-editor dark-theme" contentEditableClassName="tr-mdx-content" />
      </MdxBoundary>
    </div>
  );
}
