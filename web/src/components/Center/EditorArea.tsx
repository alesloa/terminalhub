import { copyText } from "../../lib/clipboard";
import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useRoom } from "../../store/room";
import { useToasts } from "../../store/toasts";
import { isLocalHost, revealLabel } from "../../lib/host";
import { gitignoreMenuItem, ignoreScopeLabel } from "../../lib/gitignore";
import { FileEditor } from "../Editor/EditorView";
import { EditorToggles } from "../Editor/EditorToggles";
import { MarkdownPreview } from "../Editor/MarkdownPreview";
import { CsvEditor } from "../Editor/CsvEditor";
import { DocxEditor } from "../Editor/DocxEditor";
import { HtmlEditor } from "../Editor/HtmlEditor";
import { ImageView } from "../Editor/ImageView";
import { PdfView } from "../Editor/PdfView";
import { VideoView } from "../Editor/VideoView";
import { AudioView } from "../Editor/AudioView";
import { isHtmlFile } from "../../lib/fileKinds";
import { DiffView } from "../Scm/DiffView";
import { FileContextMenu, type FileMenuEntry } from "../Scm/FileContextMenu";

const isMarkdownFile = (name: string) => /\.(md|markdown|mdx)$/i.test(name);
const isCsvFile = (name: string) => /\.(csv|tsv)$/i.test(name);
const isDocxFile = (name: string) => /\.docx$/i.test(name);

export function EditorArea({ rootPath }: { rootPath: string }) {
  const openFiles = useRoom(s => s.openFiles);
  const activeFile = useRoom(s => s.activeFile);
  const pinned = useRoom(s => s.pinnedFiles);
  const setActiveFile = useRoom(s => s.setActiveFile);
  // Editor Back/Forward — the complete file/caret navigation history (VS Code / Zed style).
  const navBack = useRoom(s => s.navBack);
  const navForward = useRoom(s => s.navForward);
  const canBack = useRoom(s => s.navIndex > 0);
  const canForward = useRoom(s => s.navIndex >= 0 && s.navIndex < s.navStack.length - 1);
  const closeFile = useRoom(s => s.closeFile);
  const closeMany = useRoom(s => s.closeMany);
  const togglePin = useRoom(s => s.togglePin);
  const openMarkdownPreview = useRoom(s => s.openMarkdownPreview);
  const openCsvPreview = useRoom(s => s.openCsvPreview);
  const openDocxPreview = useRoom(s => s.openDocxPreview);
  const openHtmlPreview = useRoom(s => s.openHtmlPreview);
  const revealInExplorer = useRoom(s => s.revealInExplorer);
  const dirty = useRoom(s => s.dirtyFiles);
  const push = useToasts(s => s.push);
  const qc = useQueryClient();
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  // Gates "Add to .gitignore" on tabs to real repos (the action only makes sense there).
  const isRepo = !!useQuery({ queryKey: ["git", "info", rootPath], queryFn: () => api.git.info(rootPath), staleTime: 30_000 }).data?.isRepo;
  const runIgnore = (rel: string, scope: "local" | "repo") =>
    api.git.ignore(rootPath, rel, scope, false)
      .then(r => {
        qc.invalidateQueries({ queryKey: ["git"] }); // refresh decorations after the change
        push(r.added ? `Added ${r.line} to ${ignoreScopeLabel(scope)}` : `${r.line} already in ${ignoreScopeLabel(scope)}`);
      })
      .catch((e: Error) => push(e.message));

  // Pinned tabs sort to the front (stable within each group), like VS Code / Zed.
  const ordered = useMemo(
    () => [...openFiles.filter(f => pinned.has(f.path)), ...openFiles.filter(f => !pinned.has(f.path))],
    [openFiles, pinned],
  );
  const activeEntry = openFiles.find(f => f.path === activeFile);
  // On a plain code tab whose file type has a rich editor, offer a one-click switch into it. (Rich
  // tabs carry their own "Edit as code" control, so this only appears on the code side.)
  const richReopen = (() => {
    const e = activeEntry;
    if (!e || (e.kind !== undefined && e.kind !== "file")) return null;
    if (isMarkdownFile(e.name)) return { title: "Open Markdown editor", onClick: () => openMarkdownPreview({ path: e.path, name: e.name }) };
    if (isCsvFile(e.name)) return { title: "Open CSV editor", onClick: () => openCsvPreview({ path: e.path, name: e.name }) };
    if (isDocxFile(e.name)) return { title: "Open Word editor", onClick: () => openDocxPreview({ path: e.path, name: e.name }) };
    if (isHtmlFile(e.name)) return { title: "Preview / edit HTML", onClick: () => openHtmlPreview({ path: e.path, name: e.name }) };
    return null;
  })();

  // The tab right-click menu. Bulk-close actions skip pinned tabs (Close All clears everything);
  // path/reveal actions only apply to real file tabs, not synthetic diff tabs.
  const menuItems = (path: string): FileMenuEntry[] => {
    const f = openFiles.find(o => o.path === path);
    if (!f) return [];
    const idx = ordered.findIndex(o => o.path === path);
    const unpinned = (list: typeof ordered) => list.filter(o => !pinned.has(o.path)).map(o => o.path);
    const others = unpinned(ordered.filter(o => o.path !== path));
    const left = unpinned(ordered.slice(0, idx));
    const right = unpinned(ordered.slice(idx + 1));

    const entries: FileMenuEntry[] = [
      { label: "Close", onClick: () => closeFile(path) },
      { label: "Close Others", disabled: others.length === 0, onClick: () => closeMany(others) },
      "sep",
      { label: "Close Left", disabled: left.length === 0, onClick: () => closeMany(left) },
      { label: "Close Right", disabled: right.length === 0, onClick: () => closeMany(right) },
      "sep",
      { label: "Close All", onClick: () => closeMany(ordered.map(o => o.path)) },
      "sep",
      { label: pinned.has(path) ? "Unpin Tab" : "Pin Tab", onClick: () => togglePin(path) },
    ];

    if (f.kind !== "diff") {
      const abs = f.path;
      const rel = abs.startsWith(rootPath + "/") ? abs.slice(rootPath.length + 1) : abs;
      entries.push(
        "sep",
        { label: "Copy Path", onClick: () => copyText(abs) },
        { label: "Copy Relative Path", onClick: () => copyText(rel) },
        "sep",
        { label: "Reveal in Explorer", onClick: () => revealInExplorer(abs) },
        ...(isLocalHost
          ? [
              { label: revealLabel, onClick: () => api.revealPath(abs).catch((e: Error) => push(e.message)) },
              { label: "Open in Default App", onClick: () => api.openPath(abs).catch((e: Error) => push(e.message)) },
            ] as FileMenuEntry[]
          : []),
        ...(isRepo ? ["sep", gitignoreMenuItem((scope) => runIgnore(rel, scope))] as FileMenuEntry[] : []),
      );
    }
    return entries;
  };

  return (
    <div className="flex-1 min-h-[120px] flex flex-col bg-canvas">
      <div className="flex items-stretch h-9 border-b border-edge text-sm">
        {/* Back / Forward sit to the LEFT of the tabs (where you reach for them), and walk the room's
            file + caret navigation history — clicking through files, jumping to definitions, and
            moving around inside a file all record stops. */}
        <div className="shrink-0 flex items-center gap-0.5 px-1.5 border-r border-edge">
          <button onClick={() => navBack()} disabled={!canBack} title="Go Back" aria-label="Go Back"
            className="w-7 h-7 inline-flex items-center justify-center rounded text-base leading-none text-muted hover:bg-surface hover:text-bright disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default">←</button>
          <button onClick={() => navForward()} disabled={!canForward} title="Go Forward" aria-label="Go Forward"
            className="w-7 h-7 inline-flex items-center justify-center rounded text-base leading-none text-muted hover:bg-surface hover:text-bright disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default">→</button>
        </div>
        <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto">
          {ordered.map(f => (
            <Tab key={f.path} active={activeFile === f.path}
              onClick={() => setActiveFile(f.path)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, path: f.path }); }}>
              {pinned.has(f.path) && <span className="text-[10px] opacity-70 leading-none">📌</span>}
              <span className="truncate max-w-[12rem]">{f.name}</span>
              <span onClick={(e) => { e.stopPropagation(); closeFile(f.path); }}
                className="ml-1 text-dim hover:text-fg">
                {dirty.has(f.path) ? "●" : "✕"}
              </span>
            </Tab>
          ))}
        </div>
        {openFiles.length > 0 && (
          <div className="shrink-0 flex items-center gap-1 px-2 border-l border-edge">
            {richReopen && (
              <button
                onClick={richReopen.onClick}
                title={richReopen.title}
                aria-label={richReopen.title}
                className="w-7 h-7 inline-flex items-center justify-center rounded text-muted hover:bg-surface hover:text-bright">
                <OpenBookIcon />
              </button>
            )}
            <EditorToggles />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 relative tr-pane">
        {openFiles.length === 0 && (
          <div className="h-full flex items-center justify-center text-dim text-sm">
            Open a file from the explorer.
          </div>
        )}
        {openFiles.map(f => (
          <div key={f.path} className={activeFile === f.path ? "absolute inset-0" : "hidden"}>
            {f.kind === "diff" && f.diff && f.root
              ? <DiffView root={f.root} file={f.diff.file} staged={f.diff.staged} untracked={f.diff.untracked} commit={f.diff.commit} stash={f.diff.stash} />
              : f.kind === "markdown-preview" && f.sourcePath
                ? <MarkdownPreview path={f.sourcePath} name={f.name} />
              : f.kind === "csv-preview"
                ? <CsvEditor path={f.sourcePath ?? f.path} name={f.name} />
              : f.kind === "docx-preview"
                ? <DocxEditor path={f.sourcePath ?? f.path} name={f.name} />
              : f.kind === "image-preview"
                ? <ImageView path={f.sourcePath ?? f.path} name={f.name} />
              : f.kind === "pdf-preview"
                ? <PdfView path={f.sourcePath ?? f.path} name={f.name} />
              : f.kind === "video-preview"
                ? <VideoView path={f.sourcePath ?? f.path} name={f.name} />
              : f.kind === "audio-preview"
                ? <AudioView path={f.sourcePath ?? f.path} name={f.name} />
              : f.kind === "html-preview"
                ? <HtmlEditor path={f.sourcePath ?? f.path} name={f.name} />
              : <FileEditor path={f.path} name={f.name} rootPath={rootPath} readOnly={f.readOnly} />}
          </div>
        ))}
      </div>

      {menu && (
        <FileContextMenu x={menu.x} y={menu.y} items={menuItems(menu.path)} dismiss={() => setMenu(null)} />
      )}
    </div>
  );
}

function OpenBookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.4 3.1h3.2c1.3 0 2.4.7 2.4 1.7v8.1c0-1-1.1-1.7-2.4-1.7H2.4z" />
      <path d="M13.6 3.1h-3.2C9.1 3.1 8 3.8 8 4.8v8.1c0-1 1.1-1.7 2.4-1.7h3.2z" />
    </svg>
  );
}

function Tab({ active, onClick, onContextMenu, children }:
  { active: boolean; onClick: () => void; onContextMenu: (e: ReactMouseEvent) => void; children: ReactNode }) {
  return (
    <button onClick={onClick} onContextMenu={onContextMenu}
      className={`px-3 flex items-center gap-1 border-r border-edge whitespace-nowrap
        ${active ? "bg-canvas text-fg border-b-2 border-b-blue-500" : "bg-canvas text-muted hover:text-fg"}`}>
      {children}
    </button>
  );
}
