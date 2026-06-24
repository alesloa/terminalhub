import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useRoom } from "../../store/room";
import { useUi } from "../../store/ui";
import { useClaudeActivity } from "../../hooks/useClaudeActivity";
import { bucketSessions, filterSessions } from "../../lib/sessionBuckets";
import type { ClaudeAgent, ClaudeSession, Workspace } from "../../api/types";
import { SessionRow } from "./SessionRow";
import { SessionDetailModal } from "./SessionDetailModal";
import { EntryEditorModal } from "./EntryEditorModal";
import { FileContextMenu, type FileMenuEntry } from "../Scm/FileContextMenu";
import { ColorPicker } from "../TerminalContextMenu";
import { ConfirmDialog } from "../ConfirmDialog";

// Default resume (double-click a session, or "Resume in terminal"). `--model "opus[1m]"` pins Claude
// Code's 1M-token context window so a resumed session opens at 1M instead of the 200k default (which
// auto-compacts fast). The quotes stop zsh from globbing the brackets. Codex has no 1M Opus mode, so
// its resume stays plain. For the proxy-routed variant see headroomResumeCommand below.
const resumeCommand = (agent: ClaudeAgent, id: string) =>
  agent === "claude" ? `claude --model "opus[1m]" --resume ${id}` : `codex resume ${id}`;
// Same resume, but routed through the Headroom compression proxy. `headroom wrap <tool>` starts (or
// reuses) the proxy and forwards unknown flags to the tool — so `--resume <id>` passes straight through.
// `--model "opus[1m]"` pins the 1M context window: through the proxy's custom base URL Claude Code skips
// Opus's subscription 1M auto-upgrade and would default to 200k (early auto-compact). The quotes keep the
// shell from globbing the brackets. Codex has no 1M Opus mode, so its resume stays untouched.
const headroomResumeCommand = (agent: ClaudeAgent, id: string) =>
  agent === "claude" ? `headroom wrap claude --model "opus[1m]" --resume ${id}` : `headroom wrap codex resume ${id}`;

export function ClaudeSessionsPanel({ rootPath }: { rootPath: string }) {
  const qc = useQueryClient();
  const workspaceId = useRoom((s) => s.workspaceId);
  const requestTerminalFocus = useUi((s) => s.requestTerminalFocus);
  const setActive = useRoom((s) => s.setActiveTerminal);

  const [tab, setTab] = useState<ClaudeAgent>("claude");
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; session: ClaudeSession } | null>(null);
  const [detail, setDetail] = useState<ClaudeSession | null>(null);
  const [editing, setEditing] = useState<ClaudeSession | null>(null);
  const [confirmDel, setConfirmDel] = useState<ClaudeSession | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [colorFor, setColorFor] = useState<{ session: ClaudeSession; x: number; y: number } | null>(null);

  const sessionsQ = useQuery({
    queryKey: ["claude", "sessions", rootPath],
    queryFn: () => api.claude.sessions(rootPath),
    refetchInterval: 8000,
  });
  const activity = useClaudeActivity(rootPath);
  // Drives the "Resume with Headroom" menu row — enabled only when the headroom CLI is present.
  const { data: hr } = useQuery({ queryKey: ["agents", "headroom"], queryFn: api.headroomStatus });

  const prefs = sessionsQ.data?.prefs ?? {};
  const pinnedIds = useMemo(
    () => new Set(Object.entries(prefs).filter(([, p]) => p.pinned).map(([id]) => id)),
    [prefs],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["claude", "sessions", rootPath] });

  const resume = useMutation({
    mutationFn: (s: ClaudeSession) =>
      api.createTerminal(workspaceId, { launchCommandOverride: resumeCommand(s.agentType, s.id), title: (s.title || s.id.slice(0, 8)).slice(0, 40) }),
    // Pending-focus channel, not setActive: the new terminal isn't in the refetched workspaces
    // list yet, so a direct setActive would be clobbered by Room's keep-active-valid effect.
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["workspaces"] }); requestTerminalFocus(workspaceId, r.terminal.id); },
  });
  const resumeHeadroom = useMutation({
    mutationFn: (s: ClaudeSession) =>
      api.createTerminal(workspaceId, { launchCommandOverride: headroomResumeCommand(s.agentType, s.id), title: (s.title || s.id.slice(0, 8)).slice(0, 40) }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["workspaces"] }); requestTerminalFocus(workspaceId, r.terminal.id); },
  });
  const setPref = useMutation({
    mutationFn: (v: { id: string; patch: { pinned?: boolean; color?: string | null } }) => api.claude.setPref(v.id, v.patch),
    onSuccess: refresh,
  });
  const rename = useMutation({
    mutationFn: (v: { s: ClaudeSession; name: string }) => api.claude.rename(v.s.agentType, v.s.id, rootPath, v.name),
    // Refresh the sessions list, and the Terminals panel too — the rename is mirrored onto any
    // terminal running this session server-side, so the tab name needs to pick it up.
    onSuccess: () => { setRenamingId(null); refresh(); qc.invalidateQueries({ queryKey: ["workspaces"] }); },
  });
  const del = useMutation({
    mutationFn: (s: ClaudeSession) => api.claude.delete(s.agentType, s.id, rootPath),
    onSuccess: () => { setConfirmDel(null); refresh(); },
  });
  const fork = useMutation({
    mutationFn: (s: ClaudeSession) => api.claude.fork(s.agentType, s.id, rootPath),
    onSuccess: refresh,
  });
  const forkCross = useMutation({
    mutationFn: (s: ClaudeSession) => api.claude.forkCross(s.agentType, s.id, rootPath),
    onSuccess: refresh,
  });

  // Open the session in a terminal — or just focus it if it's already running in one. A terminal
  // resumed from this panel carries its resume command as launchCommandOverride, so we match on that:
  // clicking a session that's already up jumps to its terminal instead of spawning a duplicate.
  const openOrFocus = (s: ClaudeSession) => {
    const cmd = resumeCommand(s.agentType, s.id);
    const cache = qc.getQueryData<{ workspaces: Workspace[] }>(["workspaces"]);
    const open = cache?.workspaces.find((w) => w.id === workspaceId)?.terminals
      ?.find((t) => t.alive !== false && t.launchCommandOverride === cmd);
    if (open) setActive(open.id);
    else resume.mutate(s);
  };

  const onContext = (e: ReactMouseEvent, session: ClaudeSession) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, session });
  };

  const menuItems = (s: ClaudeSession, at: { x: number; y: number }): FileMenuEntry[] => {
    const pinned = pinnedIds.has(s.id);
    return [
      { label: "Resume in terminal", onClick: () => resume.mutate(s) },
      { label: "Resume with Headroom", disabled: !hr?.installed,
        hint: hr?.installed ? undefined : "headroom CLI not installed",
        onClick: () => { if (hr?.installed) resumeHeadroom.mutate(s); } },
      { label: "View transcript", onClick: () => setDetail(s) },
      "sep",
      { label: pinned ? "Unpin" : "Pin", onClick: () => setPref.mutate({ id: s.id, patch: { pinned: !pinned } }) },
      { label: "Fork (clone)", onClick: () => fork.mutate(s) },
      { label: s.agentType === "claude" ? "Fork to Codex" : "Fork to Claude", onClick: () => forkCross.mutate(s) },
      { label: "Edit messages…", onClick: () => setEditing(s) },
      { label: "Rename", onClick: () => setRenamingId(s.id) },
      { label: "Set color…", onClick: () => setColorFor({ session: s, ...at }) },
      "sep",
      { label: "Delete", onClick: () => setConfirmDel(s) },
    ];
  };

  const all = sessionsQ.data?.[tab] ?? [];
  const filtered = filterSessions(all, search);
  const buckets = bucketSessions(filtered, pinnedIds);
  const counts = { claude: sessionsQ.data?.claude.length ?? 0, codex: sessionsQ.data?.codex.length ?? 0 };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* header */}
      <div className="px-3 pt-2 pb-1 flex items-center justify-between">
        <span className="text-[11px] tracking-wide text-muted">SESSIONS</span>
        <button onClick={refresh} title="Refresh" className="text-dim hover:text-fg text-xs leading-none">↻</button>
      </div>

      {/* agent tabs */}
      <div className="px-2 flex gap-1">
        {(["claude", "codex"] as const).map((a) => (
          <button key={a} onClick={() => setTab(a)}
            className={`flex-1 px-2 py-1 rounded text-xs capitalize ${tab === a ? "bg-elevated text-bright" : "text-dim hover:text-fg"}`}>
            {a} <span className="text-dim">{counts[a]}</span>
          </button>
        ))}
      </div>

      {/* search */}
      <div className="px-2 py-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sessions…"
          className="w-full px-2 py-1 rounded bg-canvas border border-edge text-xs text-fg outline-none focus:border-accent/60" />
      </div>

      {/* list */}
      <div className="flex-1 min-h-0 overflow-auto">
        {sessionsQ.isLoading && <div className="px-3 py-2 text-xs text-dim">loading sessions…</div>}
        {!sessionsQ.isLoading && all.length === 0 && (
          <div className="px-3 py-4 text-xs text-dim leading-relaxed">
            No {tab} sessions for this folder yet.
            <div className="mt-1 text-dim">Start one by running <span className="font-mono text-dim">{tab}</span> in a terminal here.</div>
          </div>
        )}
        {!sessionsQ.isLoading && all.length > 0 && filtered.length === 0 && (
          <div className="px-3 py-3 text-xs text-dim">No sessions match “{search}”.</div>
        )}
        {buckets.map((bucket) => (
          <div key={bucket.name} className="mb-1">
            <div className="px-3 py-1 text-[11px] tracking-wide text-dim sticky top-0 bg-canvas">
              {bucket.name}<span className="text-dim"> {bucket.sessions.length}</span>
            </div>
            {bucket.sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                state={activity[s.id] ?? "idle"}
                color={prefs[s.id]?.color ?? null}
                pinned={pinnedIds.has(s.id)}
                renaming={renamingId === s.id}
                onRename={(name) => rename.mutate({ s, name })}
                onCancelRename={() => setRenamingId(null)}
                onStartRename={() => setRenamingId(s.id)}
                onResume={() => openOrFocus(s)}
                onContext={(e) => onContext(e, s)}
                onOpenDetail={() => setDetail(s)}
                onFork={() => fork.mutate(s)}
                onDelete={() => setConfirmDel(s)}
              />
            ))}
          </div>
        ))}
      </div>

      {menu && <FileContextMenu x={menu.x} y={menu.y} items={menuItems(menu.session, { x: menu.x, y: menu.y })} dismiss={() => setMenu(null)} />}
      {colorFor && createPortal(
        <div className="fixed inset-0 z-[72]" onMouseDown={() => setColorFor(null)}>
          <div style={{ position: "fixed", left: Math.min(colorFor.x, window.innerWidth - 192), top: Math.min(colorFor.y, window.innerHeight - 140) }}
            onMouseDown={(e) => e.stopPropagation()}>
            <ColorPicker current={prefs[colorFor.session.id]?.color ?? null}
              onPick={(color) => { setPref.mutate({ id: colorFor.session.id, patch: { color } }); setColorFor(null); }} />
          </div>
        </div>,
        document.body,
      )}
      {detail && <SessionDetailModal session={detail} onClose={() => setDetail(null)} />}
      {editing && <EntryEditorModal session={editing} projectPath={rootPath} onClose={() => setEditing(null)} />}
      {confirmDel && (
        <ConfirmDialog
          title="Delete session?"
          body={`Delete “${confirmDel.title || confirmDel.id.slice(0, 8)}” and any of its forks? This removes the transcript from disk and can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => del.mutate(confirmDel)}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}
