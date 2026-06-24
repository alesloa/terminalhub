import { type MouseEvent as ReactMouseEvent } from "react";
import { useRoom } from "../../store/room";
import { getFileIconUrl } from "../../lib/materialIcons";
import { dirname, relativeTo } from "../../lib/paths";
import type { SearchFileResult, SearchMatch } from "../../api/types";

/** Stable key for one match (file path + position) — used for dismiss tracking. */
export const matchKey = (path: string, m: SearchMatch) => `${path}:${m.line}:${m.col}`;

/** The grouped results list: a row per file, expandable to the matching lines. Clicking a line opens
 *  the file at that match. When replace mode is on, hover affordances replace a single match or every
 *  match in a file; dismiss drops a match/file from the current results (until the next search). */
export function SearchResults({
  results, rootPath, canReplace, collapsed, onToggle, onReplaceFile, onReplaceMatch, onDismissFile, onDismissMatch,
}: {
  results: SearchFileResult[];
  rootPath: string;
  canReplace: boolean;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onReplaceFile: (path: string) => void;
  onReplaceMatch: (path: string, m: SearchMatch) => void;
  onDismissFile: (path: string) => void;
  onDismissMatch: (path: string, m: SearchMatch) => void;
}) {
  const jumpToPosition = useRoom((s) => s.jumpToPosition);
  const openMenu = useRoom((s) => s.openExplorerMenu);
  // Right-click any result row (file header or a match line) → the same file menu the Explorer uses,
  // targeting that file. The panel renders the menu; opening it also selects the file.
  const rowMenu = (e: ReactMouseEvent, f: SearchFileResult) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ x: e.clientX, y: e.clientY, target: { path: f.path, name: f.name, type: "file" } });
  };

  return (
    <div className="text-sm select-none">
      {results.map((f) => {
        const isCollapsed = collapsed.has(f.path);
        const parent = dirname(f.path);
        const dir = parent === rootPath ? "" : relativeTo(parent, rootPath);
        const icon = getFileIconUrl(f.name);
        return (
          <div key={f.path}>
            {/* File header */}
            <div className="group flex items-center gap-1 px-2 py-0.5 hover:bg-surface cursor-pointer"
              onClick={() => onToggle(f.path)} onContextMenu={(e) => rowMenu(e, f)} title={f.path}>
              <span className="text-dim w-3 shrink-0 text-center">{isCollapsed ? "▸" : "▾"}</span>
              {icon && <img src={icon} alt="" aria-hidden draggable={false} className="w-4 h-4 shrink-0" />}
              <span className="text-fg truncate">{f.name}</span>
              {dir && <span className="text-dim text-xs truncate min-w-0">{dir}</span>}
              <span className="ml-auto flex items-center gap-0.5 shrink-0">
                {canReplace && (
                  <button title="Replace all in file"
                    onClick={(e) => { e.stopPropagation(); onReplaceFile(f.path); }}
                    className="hidden group-hover:flex w-4 h-4 items-center justify-center rounded text-dim hover:bg-elevated hover:text-fg">
                    <ReplaceAllIcon />
                  </button>
                )}
                <button title="Dismiss"
                  onClick={(e) => { e.stopPropagation(); onDismissFile(f.path); }}
                  className="hidden group-hover:flex w-4 h-4 items-center justify-center rounded text-dim hover:bg-elevated hover:text-fg">✕</button>
                <span className="group-hover:hidden grid place-items-center min-w-4 h-4 px-1 rounded-full bg-elevated text-[10px] text-dim">{f.matches.length}</span>
              </span>
            </div>

            {/* Match lines */}
            {!isCollapsed && f.matches.map((m) => (
              <div key={matchKey(f.path, m)}
                className="group flex items-center gap-1 pl-7 pr-2 py-0.5 hover:bg-surface cursor-pointer"
                title={`Line ${m.line}`}
                onClick={() => jumpToPosition({ path: f.path, name: f.name }, m.line, m.col)}
                onContextMenu={(e) => rowMenu(e, f)}>
                <MatchLine m={m} />
                <span className="ml-auto flex items-center gap-0.5 shrink-0">
                  {canReplace && (
                    <button title="Replace"
                      onClick={(e) => { e.stopPropagation(); onReplaceMatch(f.path, m); }}
                      className="hidden group-hover:flex w-4 h-4 items-center justify-center rounded text-dim hover:bg-elevated hover:text-fg">
                      <ReplaceIcon />
                    </button>
                  )}
                  <button title="Dismiss"
                    onClick={(e) => { e.stopPropagation(); onDismissMatch(f.path, m); }}
                    className="hidden group-hover:flex w-4 h-4 items-center justify-center rounded text-dim hover:bg-elevated hover:text-fg">✕</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** One result line: the source text with the matched span highlighted. Leading indentation is
 *  trimmed for density (the highlight offset is shifted to match). */
function MatchLine({ m }: { m: SearchMatch }) {
  const lead = m.text.length - m.text.trimStart().length;
  const text = m.text.slice(lead);
  const start = Math.max(0, m.matchStart - lead);
  const end = start + m.length;
  return (
    <span className="truncate min-w-0 text-muted font-mono text-xs leading-5">
      {text.slice(0, start)}
      <mark className="bg-amber-400/30 text-fg rounded-sm">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </span>
  );
}

function ReplaceIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M8 3v6M5.5 6.5L8 9l2.5-2.5" /><path d="M3.5 12.5h9" />
    </svg>
  );
}
function ReplaceAllIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.25">
      <path d="M5 3v4.5M3 6l2 2 2-2M11 3v4.5M9 6l2 2 2-2" /><path d="M3.5 12.5h9" />
    </svg>
  );
}
