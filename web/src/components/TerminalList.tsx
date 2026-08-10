import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  DndContext, MouseSensor, TouchSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors,
  type DragStartEvent, type DragMoveEvent, type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Terminal, Workspace } from "../api/types";
import { useRoom } from "../store/room";
import { useUi } from "../store/ui";
import { useAttention } from "../hooks/useAttention";
import { useWorking } from "../hooks/useWorking";
import { useSetTerminalMode } from "../hooks/useTerminalMode";
import { useToasts } from "../store/toasts";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { IconPicker } from "./IconPicker";
import { FileContextMenu, type FileMenuEntry } from "./Scm/FileContextMenu";
import { agentIdForCommand, agentIconPath, AGENT_COLORS, type AgentId } from "../lib/agents";

interface MenuState { anchor: { x: number; y: number }; term: Terminal; index: number }
/** Which row the drop line is drawn on, and on which edge (insert above vs below it). */
interface DropTarget { id: string; before: boolean }

export function TerminalList({ workspaceId, terminals, width }: { workspaceId: string; terminals: Terminal[]; width: number }) {
  const qc = useQueryClient();
  const active = useRoom(s => s.activeTerminalId);
  const setActive = useRoom(s => s.setActiveTerminal);
  const openPicker = useRoom(s => s.openAgentPicker);
  const refresh = () => qc.invalidateQueries({ queryKey: ["workspaces"] });

  const push = useToasts(s => s.push);
  // Folder of this room's workspace — needed to fork a detected session into the right project.
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const ws = wsData?.workspaces.find(w => w.id === workspaceId);
  const folder = ws?.folder ?? "";
  // The workspace's default launch command — the fallback when a terminal has no per-terminal
  // override, so we can tell which agent (if any) a terminal is running for its default icon/color.
  const wsLaunch = ws?.launchCommand ?? "";

  const del = useMutation({ mutationFn: (id: string) => api.deleteTerminal(id), onSuccess: refresh });
  const patch = useMutation({
    mutationFn: ({ id, b }: { id: string; b: { title?: string; color?: string | null; icon?: string | null } }) => api.updateTerminal(id, b),
    // Refresh the tabs, and the Sessions panel too — a title rename is mirrored onto the running
    // agent session server-side, so the left panel needs to pick up the new name.
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["claude", "sessions", folder] }); },
  });

  // Detect + clone the agent session running in a terminal. The server owns the detect→fork
  // sequence; we just refresh the panel and report the outcome.
  const forkSession = useMutation({
    mutationFn: (terminalId: string) => api.claude.forkFromTerminal(terminalId),
    onSuccess: (r) => {
      if (r.newSessionId) { push("Forked the terminal's session — see the Sessions panel"); qc.invalidateQueries({ queryKey: ["claude", "sessions", folder] }); }
      else push("No running Claude session found in this terminal");
    },
    onError: (e: unknown) => push(e instanceof Error ? e.message : "fork failed"),
  });

  // Pane ⇄ GUI chat. Same mutation the pane's own segmented switch uses (a 409 mid-turn surfaces the
  // server's reason as a toast), so both entry points behave identically.
  const setMode = useSetTerminalMode();

  const needsAttention = new Set(useAttention().map(a => a.terminalId));
  // Agents actively thinking/streaming right now — same poll that drives the card working dots.
  const workingNow = new Set(useWorking().map(w => w.terminalId));
  const previewColors = useUi(s => s.previewColors);
  const clearPreviewColor = useUi(s => s.clearPreviewColor);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [bgMenu, setBgMenu] = useState<{ x: number; y: number } | null>(null); // empty-space menu
  const [iconFor, setIconFor] = useState<Terminal | null>(null); // terminal whose icon picker is open
  const [editing, setEditing] = useState<string | null>(null); // terminal id being renamed inline
  const [draft, setDraft] = useState("");

  const startEdit = (t: Terminal) => { setEditing(t.id); setDraft(t.title); };
  const commitEdit = (t: Terminal) => {
    const v = draft.trim();
    if (v && v !== t.title) patch.mutate({ id: t.id, b: { title: v } });
    setEditing(null);
  };
  // Commit a tab color: optimistically patch the cache (no flicker), drop the preview, then persist.
  const onColor = (id: string, color: string | null) => {
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
      old ? { ...old, workspaces: old.workspaces.map(w => ({ ...w, terminals: w.terminals?.map(t => t.id === id ? { ...t, color } : t) })) } : old);
    clearPreviewColor(id);
    patch.mutate({ id, b: { color } });
  };
  // Optimistically paint the new icon into the cache (no flicker), then persist. null = default glyph.
  const onIcon = (id: string, icon: string | null) => {
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
      old ? { ...old, workspaces: old.workspaces.map(w => ({ ...w, terminals: w.terminals?.map(t => t.id === id ? { ...t, icon } : t) })) } : old);
    patch.mutate({ id, b: { icon } });
  };
  const onClose = (ids: string[]) => ids.forEach(id => del.mutate(id));

  // Right-click menu for the list's empty space (below the rows): the obvious global actions that
  // don't belong to any one terminal — spin up a new one, or close them all. A right-click on a row
  // is handled by the per-terminal menu (TerminalContextMenu) instead.
  const bgMenuItems = (): FileMenuEntry[] => {
    const ids = terminals.map(t => t.id);
    return [
      { label: "New Terminal", onClick: openPicker },
      "sep",
      { label: "Close All Terminals", disabled: ids.length === 0, onClick: () => onClose(ids) },
    ];
  };

  // --- Drag to reorder ---------------------------------------------------------------------------
  // Each row is BOTH a draggable and a drop target (stable geometry — no inserted spacer rows that
  // shift the list mid-drag). The grabbed row follows the cursor by translating ITSELF on the Y axis
  // (a relative CSS transform — works even though the Room frame is a transformed ancestor, which
  // would break a fixed-position DragOverlay). A blue line is drawn on the top or bottom edge of the
  // row the cursor is over (whichever half), marking exactly where the terminal will land. On drop we
  // optimistically reorder the cache (instant) and POST the move to persist it.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Mouse: 8px drag to start (taps/clicks still pass through). Touch: press-and-hold (~0.2s) to start
  // a reorder so a quick finger swipe scrolls the list natively instead of grabbing a row. Mirrors the
  // canvas sensors (SpaceCanvas); `tolerance` cancels the pending hold if the finger travels first.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  // True from drag-start until just after drag-end, so the click a drag emits on pointer-up doesn't
  // also "select" the row — a pure reorder shouldn't change which terminal is on screen.
  const dragHappened = useRef(false);
  const move = useMutation({
    mutationFn: ({ id, index }: { id: string; index: number }) => api.moveTerminal(id, index),
    onSuccess: refresh,
  });
  // Splice the dragged terminal to `index` (its slot in the list with the dragged row removed) in the
  // workspaces cache so the panel reorders the instant you drop, renumbering positions to match what
  // the server will write — then persist. onSuccess refetch reconciles.
  const reorder = (id: string, index: number) => {
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) => {
      if (!old) return old;
      return { ...old, workspaces: old.workspaces.map(w => {
        if (w.id !== workspaceId || !w.terminals) return w;
        const arr = w.terminals.slice();
        const from = arr.findIndex(t => t.id === id);
        if (from < 0) return w;
        const [moved] = arr.splice(from, 1);
        arr.splice(index, 0, moved);
        return { ...w, terminals: arr.map((t, i) => ({ ...t, position: i })) };
      }) };
    });
    move.mutate({ id, index });
  };
  // Is the dragged row's mid-line above the hovered row's mid-line? → insert before it, else after.
  const edgeFor = (e: DragMoveEvent | DragEndEvent): DropTarget | null => {
    const { active: a, over } = e;
    if (!over || over.id === a.id) return null;
    const aRect = a.rect.current.translated, oRect = over.rect;
    if (!aRect) return null;
    const before = aRect.top + aRect.height / 2 < oRect.top + oRect.height / 2;
    return { id: String(over.id), before };
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    setDropTarget(null);
    setTimeout(() => { dragHappened.current = false; }, 0);
    const t = edgeFor(e);
    if (!t) return;
    const id = String(e.active.id);
    const from = terminals.findIndex(x => x.id === id);
    const overIndex = terminals.findIndex(x => x.id === t.id);
    if (from < 0 || overIndex < 0) return;
    // target = the over row's index, +1 if dropping below it. Pulling the dragged row out first
    // shifts everything after its old spot up one, so a target past it lands one slot earlier.
    let index = t.before ? overIndex : overIndex + 1;
    if (from < index) index -= 1;
    if (index === from) return; // dropped back where it started
    reorder(id, index);
  };

  return (
    // tabIndex makes the panel focusable so clicking a terminal row lights the active-pane ring
    // (the rows themselves aren't focus targets); outline-none defers to our ring.
    <div style={{ width }} tabIndex={0} className="flex-1 min-h-0 flex flex-col tr-pane outline-none">
      <div className="flex items-center justify-between px-3 py-2 text-xs uppercase text-muted">
        Terminals <button onClick={openPicker} className="text-lg leading-none">+</button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={(e: DragStartEvent) => { dragHappened.current = true; setDragId(String(e.active.id)); }}
        onDragMove={(e) => setDropTarget(edgeFor(e))}
        onDragEnd={onDragEnd}
        onDragCancel={() => { setDragId(null); setDropTarget(null); setTimeout(() => { dragHappened.current = false; }, 0); }}>
        <div className="flex-1 overflow-auto"
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget) return; // a row's own handler covers row right-clicks
            e.preventDefault();
            setBgMenu({ x: e.clientX, y: e.clientY });
          }}>
          {terminals.map((t, i) => {
            const attn = needsAttention.has(t.id);
            // Attention (needs you) outranks working (busy) — at most one gutter dot, same precedence as the cards.
            const working = !attn && workingNow.has(t.id);
            const isEditing = editing === t.id;
            // Which agent (if any) this terminal runs — its per-terminal override command, else the
            // workspace default. Drives the default ICON color + the working-animation color (NOT the
            // label text, which keeps the user's own color / default). `??` not `||`: a plain terminal
            // is stored with an EMPTY override ("") and must stay a plain shell (terminal glyph) — only
            // a null override (none set) inherits the workspace's launch command. A GUI terminal has
            // no launch command at all (the agent runs as an SDK child, not in the pane) — it's always
            // Claude, so it wears the Claude brand directly instead of the plain-shell fallback.
            const agentId = t.mode === "gui" ? "claude" : agentIdForCommand(t.launchCommandOverride ?? wsLaunch);
            // Label tint: live preview (dragging the picker) wins, then the user's explicit color.
            // undefined = theme default. The agent color is intentionally NOT applied here.
            const tint = (previewColors[t.id] !== undefined ? previewColors[t.id] : t.color) ?? undefined;
            const dropEdge = dropTarget && dropTarget.id === t.id ? (dropTarget.before ? "top" : "bottom") : null;
            return (
              <TerminalRow
                key={t.id}
                t={t} active={active === t.id} attn={attn} working={working} tint={tint} agentId={agentId} dropEdge={dropEdge}
                isEditing={isEditing} draft={draft} dragDisabled={isEditing}
                onSelect={() => { if (!dragHappened.current) setActive(t.id); }}
                onContext={(e) => {
                  e.preventDefault();
                  setMenu({ anchor: { x: e.clientX, y: e.clientY }, term: t, index: i });
                }}
                onDoubleClick={() => startEdit(t)}
                onIconClick={() => setIconFor(t)}
                onDelete={() => del.mutate(t.id)}
                onDraftChange={setDraft}
                onCommitEdit={() => commitEdit(t)}
                onCancelEdit={() => setEditing(null)}
              />
            );
          })}
        </div>
      </DndContext>
      {menu && (
        <TerminalContextMenu
          anchor={menu.anchor} term={menu.term} index={menu.index} terminals={terminals}
          onRename={startEdit} onChangeIcon={(t) => setIconFor(t)} onColor={onColor} onClose={onClose}
          onForkSession={(t) => forkSession.mutate(t.id)}
          onSetMode={(t, mode) => setMode.mutate({ id: t.id, mode })}
          dismiss={() => setMenu(null)} />
      )}
      {iconFor && (
        <IconPicker current={iconFor.icon}
          onPick={(name) => { onIcon(iconFor.id, name); setIconFor(null); }}
          onClose={() => setIconFor(null)} />
      )}
      {bgMenu && (
        <FileContextMenu x={bgMenu.x} y={bgMenu.y} items={bgMenuItems()} dismiss={() => setBgMenu(null)} />
      )}
    </div>
  );
}

/** One terminal row in the list. The whole row drags to reorder (disabled while its name is being
 *  edited inline so you can select text); click selects, double-click renames, right-click opens the
 *  menu. While grabbed the row follows the cursor (Y-axis translate) and floats above its siblings;
 *  a blue line on its top/bottom edge marks an incoming drop. Icon + close buttons stop propagation
 *  so they don't also select/drag. */
function TerminalRow({
  t, active, attn, working, tint, agentId, dropEdge, isEditing, draft, dragDisabled,
  onSelect, onContext, onDoubleClick, onIconClick, onDelete, onDraftChange, onCommitEdit, onCancelEdit,
}: {
  t: Terminal; active: boolean; attn: boolean; working: boolean; tint: string | undefined; agentId: AgentId | null; dropEdge: "top" | "bottom" | null;
  isEditing: boolean; draft: string; dragDisabled: boolean;
  onSelect: () => void; onContext: (e: ReactMouseEvent) => void; onDoubleClick: () => void;
  onIconClick: () => void; onDelete: () => void;
  onDraftChange: (v: string) => void; onCommitEdit: () => void; onCancelEdit: () => void;
}) {
  // The agent's brand color — colors the icon and the working animation (equalizer + sweep). Null for
  // a plain shell / custom agent, where the animation falls back to the default info blue.
  const agentColor = agentId ? AGENT_COLORS[agentId] : null;
  const workColor = agentColor ?? "rgb(var(--tr-info))";
  const drag = useDraggable({ id: t.id, disabled: dragDisabled });
  // The actively-dragged row is removed from the drop targets so it can't collide with itself —
  // closestCenter then snaps the line to a real neighbour.
  const drop = useDroppable({ id: t.id, disabled: dragDisabled || drag.isDragging });
  const setRef = (el: HTMLDivElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  const line = "pointer-events-none absolute left-2 right-2 h-0.5 rounded bg-blue-500 z-10 shadow-[0_0_6px_1px_rgba(59,130,246,0.7)]";
  return (
    <div ref={setRef} {...drag.attributes} {...(dragDisabled ? {} : drag.listeners)}
      onClick={onSelect}
      onContextMenu={onContext}
      onDoubleClick={onDoubleClick}
      style={{
        transform: drag.transform ? `translate3d(0, ${drag.transform.y}px, 0)` : undefined,
        zIndex: drag.isDragging ? 20 : undefined,
      }}
      // While grabbed the row goes transparent (no fill/ring) so only the name rides the cursor and
      // the blue drop line between rows stays visible underneath.
      className={`group relative px-3 py-2 text-sm cursor-pointer flex items-center gap-2 ${drag.isDragging ? "" : (active ? "bg-elevated" : "hover:bg-surface")}`}>
      {dropEdge === "top" && <span className={`${line} -top-px`} />}
      {dropEdge === "bottom" && <span className={`${line} -bottom-px`} />}
      {/* Left gutter (left-1 → right edge at the row's px-3 padding, where the icon starts). Amber dot
          blinks when the agent needs you; while it's WORKING we show blue equalizer bars instead —
          motion that reads as "doing something", distinct from the attention dot. When either shows,
          the icon nudges right (ml-2 = 8px, matching gap-2) to clear it. Hidden while dragging so only
          the name chip rides the cursor. */}
      {attn ? (
        <span className="absolute left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-400 tr-blink" title="needs attention" />
      ) : working && !drag.isDragging ? (
        <span className="tr-eq absolute left-1 top-1/2 -translate-y-1/2" style={{ color: workColor }} title="working…">
          <i /><i /><i />
        </span>
      ) : null}
      {/* Working sweep: the same KITT light as the workspace cards, gliding along this row's bottom
          edge — in the agent's color (matching the icon + equalizer). Pairs with the bars above. */}
      {working && !drag.isDragging && (
        <span className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] overflow-hidden rounded">
          <span className="tr-kitt absolute inset-y-0 left-0 w-1/3 rounded"
            style={{ "--tr-glow-color": workColor } as CSSProperties} />
        </span>
      )}
      {/* Icon left of the name; click to open the picker. With no user override (t.icon == null) an
          agent terminal shows its brand glyph painted in the agent color (Claude/Codex/opencode/
          Cursor), a plain shell the terminal glyph; a picked codicon overrides either. The brand SVG
          is rendered as a CSS mask so it takes the agent color (an <img> can't be recolored). Hidden
          while dragging so only the name chip rides the cursor. */}
      {!drag.isDragging && (
        <button onClick={(e) => { e.stopPropagation(); onIconClick(); }} title="Change icon"
          className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-muted hover:text-bright hover:bg-edge-strong transition-[margin] ${attn || working ? "ml-2" : ""}`}>
          {t.icon == null && agentId ? (
            <span aria-hidden className="w-4 h-4 inline-block"
              style={{
                backgroundColor: AGENT_COLORS[agentId],
                WebkitMaskImage: `url(${agentIconPath(agentId)})`, maskImage: `url(${agentIconPath(agentId)})`,
                WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
                WebkitMaskPosition: "center", maskPosition: "center",
                WebkitMaskSize: "contain", maskSize: "contain",
              }} />
          ) : (
            <span className={`codicon codicon-${t.icon ?? "terminal"} text-sm`} style={{ color: tint }} aria-hidden />
          )}
        </button>
      )}
      {isEditing ? (
        <input autoFocus value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onFocus={(e) => e.target.select()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitEdit();
            else if (e.key === "Escape") onCancelEdit();
          }}
          onBlur={onCommitEdit}
          className="flex-1 min-w-0 bg-canvas border border-accent rounded px-1 py-0.5 text-sm outline-none"
          style={{ color: tint }} />
      ) : drag.isDragging ? (
        // Dragging: just the name in a little chip (square background) riding the cursor — no icon,
        // no close button, so the blue drop line between rows stays clearly visible.
        <span className="max-w-full truncate bg-elevated rounded px-2 py-0.5 shadow-md ring-1 ring-edge-strong" style={{ color: tint }}>{t.title}</span>
      ) : (
        <>
          <span className="flex-1 truncate" style={{ color: tint }}>{t.title}</span>
          {/* GUI-mode marker: this row is an in-app chat, not a pane. Sized like the row's other
              chrome (the icon/close buttons) so it reads as a quiet tag, not a button. */}
          {t.mode === "gui" && (
            <span title="In-app Claude chat — right-click for “Back to Terminal”"
              className="shrink-0 px-1 rounded border border-edge-strong text-[9px] leading-[13px] tracking-wide text-dim">
              GUI
            </span>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Close terminal"
            className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-dim text-xs leading-none opacity-0 group-hover:opacity-100 hover:text-bright hover:bg-edge-strong">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
