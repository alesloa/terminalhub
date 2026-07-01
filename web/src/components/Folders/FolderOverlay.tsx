import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Folder, Space, Workspace } from "../../api/types";
import type { RoomOrigin } from "../../store/ui";
import { useUi } from "../../store/ui";
import { WorkspaceContextMenu } from "../WorkspaceContextMenu";

const ACCENT = "rgb(var(--tr-accent))";
const accentOf = (w: Workspace) => w.cardColor ?? w.color ?? ACCENT;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The expanded folder: it grows OUT of the folder tile — the panel's top-left corner pins to the
 * tile's top-left and it scales up from there (transform-origin set to that corner), so it unfolds
 * down-and-right out of the folder rather than popping in the middle of the screen. Collapses back
 * into the tile the same way on close. Lists the member cards as little openable cards — click one to
 * jump into its room. Each card has the SAME right-click menu as a loose canvas card (Open, Rename,
 * Card Color, Move to space, Add to Favorites, Remove) plus "Remove from folder", and can be
 * **dragged outside the panel to pop it back onto the canvas**. Portals to <body>; closes on ✕,
 * backdrop click, or Esc.
 */
export function FolderOverlay({
  folder, members, origin, attentionIds, workingIds, spaces, focusName,
  onClose, onOpenRoom, onRename, onPopOut, onDissolve,
  onColorWorkspace, onMoveWorkspace, onDeleteWorkspace, onRenameWorkspace,
}: {
  folder: Folder; members: Workspace[]; origin: RoomOrigin | null; spaces: Space[];
  attentionIds: Set<string>; workingIds: Set<string>;
  // Opened via the tile's "Rename group…" menu item — focus + select the name field on mount.
  focusName?: boolean;
  onClose: () => void;
  onOpenRoom: (workspaceId: string, origin: RoomOrigin) => void;
  onRename: (name: string) => void;
  onPopOut: (workspaceId: string) => void;
  onDissolve: () => void;
  onColorWorkspace: (id: string, color: string | null) => void;
  onMoveWorkspace: (wsId: string, spaceId: string) => void;
  onDeleteWorkspace: (ws: Workspace) => void;
  onRenameWorkspace: (id: string, name: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  // Position + grow-origin are measured from the real panel size once it's mounted (synchronously,
  // before paint). Until measured (`geom` null) the panel renders hidden — laid out so we can read its
  // size, but never painted, so there's no flash at the wrong spot.
  const [geom, setGeom] = useState<{ left: number; top: number; transformOrigin: string; startScale: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [name, setName] = useState(folder.name);
  // The member card right-click menu (lifted here so the backdrop/Esc know one is open and don't close
  // the whole folder underneath it) + which member is being inline-renamed.
  const [menu, setMenu] = useState<{ wsId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // A member card being dragged out of the panel. `outside` = the cursor has left the panel, so a
  // release will pop the card back onto the canvas (the ghost flips to a "remove" cue).
  const [drag, setDrag] = useState<{ id: string; name: string; accent: string; x: number; y: number; outside: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const W = el.offsetWidth, H = el.offsetHeight; // layout size — unaffected by the scale transform
    const vw = window.innerWidth, vh = window.innerHeight;
    const anchored = !!origin && origin.w > 0 && origin.h > 0;
    if (!anchored) { // no opener rect (rare) → fall back to a centered grow
      setGeom({ left: (vw - W) / 2, top: (vh - H) / 2, transformOrigin: "50% 50%", startScale: 0.9 });
      return;
    }
    const anchorX = origin!.x, anchorY = origin!.y; // the folder tile's top-left corner
    const left = clamp(anchorX, 8, Math.max(8, vw - W - 8));
    const top = clamp(anchorY, 8, Math.max(8, vh - H - 8));
    setGeom({ left, top, transformOrigin: `${anchorX - left}px ${anchorY - top}px`, startScale: clamp(origin!.w / W, 0.2, 0.5) });
  }, [origin]);

  const close = () => setClosing(true); // plays the fold-out; the panel's animationend then fires onClose

  // Opened via "Rename group…": once the panel has a position, focus + select the name so you can type
  // the new name right away (a frame after mount so the grow-in animation doesn't steal focus).
  useEffect(() => {
    if (!focusName || !geom) return;
    const id = requestAnimationFrame(() => { nameRef.current?.focus(); nameRef.current?.select(); });
    return () => cancelAnimationFrame(id);
  }, [focusName, geom]);

  useEffect(() => {
    // Capture-phase + stopPropagation so this is the single Esc authority while the folder is open:
    // peel back the open menu / active rename first, only then close the folder itself.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (drag) { setDrag(null); return; }
      if (menu) { setMenu(null); return; }
      if (renamingId) { setRenamingId(null); return; }
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [drag, menu, renamingId]);

  // Guarantee the unmount after the fold-out. A congested main thread can drop the animationend event,
  // and without this the invisible full-screen backdrop would linger and swallow every canvas click.
  useEffect(() => {
    if (!closing) return;
    const id = setTimeout(onClose, 240);
    return () => clearTimeout(id);
  }, [closing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitName = () => { const n = name.trim(); if (n !== folder.name) onRename(n); };

  // Open a member's room, growing from its on-screen card (looked up by data attr so the menu's "Open"
  // and the card's Open button share one path), then fold the folder shut.
  const openMember = (wsId: string) => {
    const el = panelRef.current?.querySelector(`[data-member="${wsId}"]`) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    onOpenRoom(wsId, r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 });
    onClose();
  };

  // Begin a pointer-drag on a member card. Self-contained (its own window listeners, removed on
  // release) so it never touches the canvas DndContext. Past an 8px threshold a floating ghost
  // tracks the cursor; releasing with the cursor OUTSIDE the panel pops the card back to the canvas.
  const startCardDrag = (w: Workspace, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    const dname = w.name, accent = accentOf(w);
    let activated = false;
    const isOutside = (cx: number, cy: number) => {
      const r = panelRef.current?.getBoundingClientRect();
      return !r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom;
    };
    const onMove = (ev: PointerEvent) => {
      if (!activated) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        activated = true;
      }
      setDrag({ id: w.id, name: dname, accent, x: ev.clientX, y: ev.clientY, outside: isOutside(ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      setDrag(null);
      if (activated && isOutside(ev.clientX, ev.clientY)) onPopOut(w.id);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
  };

  const panel: CSSProperties = geom
    ? {
        position: "fixed", left: geom.left, top: geom.top, transformOrigin: geom.transformOrigin,
        ["--tr-fold-start" as never]: geom.startScale,
        animation: closing
          ? "tr-fold-out 190ms cubic-bezier(.4,0,1,1) forwards"
          : "tr-fold-in 280ms cubic-bezier(.16,1,.3,1) both",
      }
    : { position: "fixed", left: 0, top: 0, visibility: "hidden" };

  const menuWs = menu ? members.find((m) => m.id === menu.wsId) : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-lg"
        style={{ animation: closing ? "tr-fade-out 190ms ease forwards" : "tr-fade-in 200ms ease both" }}
        // A backdrop click closes the folder — but not while a card menu, inline rename, or drag-out is
        // mid-flight (those want the first click to just dismiss themselves).
        onMouseDown={() => { if (!menu && !renamingId && !drag) close(); }} />
      <div
        ref={panelRef}
        style={panel}
        onAnimationEnd={(e) => { if (closing && e.animationName === "tr-fold-out") onClose(); }}
        className="flex max-h-[80vh] w-[760px] max-w-[92vw] flex-col rounded-2xl border border-edge-strong bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="Folder name"
              className="min-w-0 max-w-[220px] bg-transparent font-semibold text-bright outline-none placeholder:text-dim focus:underline" />
            <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted tabular-nums">{members.length} workspace{members.length === 1 ? "" : "s"}</span>
          </div>
          <button onClick={close} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-surface hover:text-bright">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 overflow-y-auto p-4">
          {members.map((w) => (
            <MemberCard key={w.id} w={w} attentionIds={attentionIds} workingIds={workingIds}
              renaming={renamingId === w.id} dragging={drag?.id === w.id}
              onOpen={() => openMember(w.id)}
              onPopOut={() => onPopOut(w.id)}
              onDragStart={(e) => startCardDrag(w, e)}
              onContextMenu={(x, y) => setMenu({ wsId: w.id, x, y })}
              onRename={(n) => { onRenameWorkspace(w.id, n); setRenamingId(null); }}
              onCancelRename={() => setRenamingId(null)} />
          ))}
          {members.length === 0 && (
            <div className="col-span-3 py-8 text-center text-xs text-dim">This folder is empty.</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-edge px-4 py-2 text-[11px] text-dim">
          <span>Drag a card out — or right-click it — to remove it from the folder · rename above · Esc to close</span>
          <button onClick={() => { onDissolve(); onClose(); }} className="text-muted transition hover:text-error">Dissolve folder</button>
        </div>
      </div>

      {/* Floating ghost while dragging a card out; flips to a red "release to remove" cue once the
          cursor leaves the panel. pointer-events-none so it never blocks the underlying release. */}
      {drag && (
        <div className="pointer-events-none fixed z-[90] w-56 rounded-lg border bg-canvas p-2.5 shadow-2xl"
          style={{ left: drag.x + 12, top: drag.y + 12, borderColor: drag.outside ? "rgb(var(--tr-error))" : "rgb(var(--tr-edge-strong))", borderLeft: `4px solid ${drag.accent}` }}>
          <div className="truncate text-[13px] font-semibold text-bright">{drag.name}</div>
          <div className={`mt-0.5 text-[11px] ${drag.outside ? "text-error" : "text-dim"}`}>{drag.outside ? "Release to remove from folder" : "Drag outside to remove"}</div>
        </div>
      )}

      {menu && menuWs && (
        <WorkspaceContextMenu anchor={{ x: menu.x, y: menu.y }} workspace={menuWs} spaces={spaces} isDesktop={false}
          onOpen={() => openMember(menuWs.id)}
          onDelete={() => onDeleteWorkspace(menuWs)}
          onColor={onColorWorkspace}
          onMove={(spaceId) => onMoveWorkspace(menuWs.id, spaceId)}
          onBeginRename={() => setRenamingId(menuWs.id)}
          onRemoveFromFolder={() => onPopOut(menuWs.id)}
          dismiss={() => setMenu(null)} />
      )}
    </div>,
    document.body,
  );
}

function MemberCard({ w, attentionIds, workingIds, renaming, dragging, onOpen, onPopOut, onDragStart, onContextMenu, onRename, onCancelRename }: {
  w: Workspace; attentionIds: Set<string>; workingIds: Set<string>;
  renaming: boolean; dragging: boolean;
  onOpen: () => void; onPopOut: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onContextMenu: (x: number, y: number) => void;
  onRename: (name: string) => void; onCancelRename: () => void;
}) {
  const terms = w.terminals ?? [];
  // Live-preview the border while the color picker's slider is dragged (mirrors WorkspaceCard).
  const preview = useUi((s) => s.previewColors[w.id]);
  const accent = (preview !== undefined ? preview : (w.cardColor ?? w.color)) ?? ACCENT;
  // Set on Escape so the unmount-blur cancels instead of committing.
  const cancel = useRef(false);
  return (
    <div data-member={w.id}
      onPointerDown={renaming ? undefined : onDragStart}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY); }}
      className={`group relative rounded-lg border border-edge bg-canvas p-2.5 shadow transition ${dragging ? "opacity-40" : ""} ${renaming ? "" : "cursor-grab active:cursor-grabbing"}`}
      style={{ borderLeft: `4px solid ${accent}` }}>
      <button onClick={onPopOut} onPointerDown={(e) => e.stopPropagation()} aria-label="Pop out of folder" title="Remove from folder"
        className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full text-muted opacity-0 transition hover:bg-surface hover:text-bright group-hover:opacity-100">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4M8 8l4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
      </button>
      <div className="flex items-center justify-between pr-5">
        {renaming ? (
          <input autoFocus defaultValue={w.name}
            onFocus={(e) => e.target.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") { cancel.current = true; e.currentTarget.blur(); }
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!cancel.current && v && v !== w.name) onRename(v); else onCancelRename();
              cancel.current = false;
            }}
            className="min-w-0 flex-1 rounded bg-elevated px-1 py-0 text-[13px] font-semibold text-bright outline-none ring-1 ring-blue-500" />
        ) : (
          <div className="truncate text-[13px] font-semibold text-bright">{w.name}</div>
        )}
        <div className="flex shrink-0 gap-1">
          {terms.map((t) => {
            const attn = attentionIds.has(t.id);
            const working = !attn && workingIds.has(t.id);
            const bg = attn ? "#fbbf24" : (t.alive || working) ? "rgb(var(--tr-success))" : "rgb(var(--tr-text-dim))";
            return <span key={t.id} className="inline-block h-2 w-2 rounded-full" style={{ background: bg }} />;
          })}
        </div>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted">{w.folder}</div>
      <button onClick={onOpen} onPointerDown={(e) => e.stopPropagation()} className="mt-2 w-full rounded bg-[#1c1c1c] py-1 text-center text-[12px] font-medium hover:bg-edge">Open</button>
    </div>
  );
}
