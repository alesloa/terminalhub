import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useUi } from "../store/ui";
import { useAttention } from "../hooks/useAttention";
import { useWorking } from "../hooks/useWorking";
import { useGoToTerminal } from "../hooks/useGoToTerminal";

/** Windows-style taskbar pinned to the bottom-left of the home stats bar: one pill per open room.
 *  Click a pill to jump to that room — sliding to its space and bringing it to the front via the
 *  shared go-to navigation (same path a toast/notification click uses, so it never changes the
 *  room's window mode). Each pill carries the SAME per-terminal status dots the workspace card
 *  shows (attention amber-blink outranks working green-pulse outranks alive green outranks dead
 *  dim) so you can see at a glance which room is busy or ready. The front-most (focused) room's
 *  pill stays highlighted. Pills appear the instant a room opens and vanish when it closes —
 *  `openRooms` is the single source of truth. */
export function RoomTaskbar() {
  const openRooms = useUi(s => s.openRooms);
  const activeSpaceId = useUi(s => s.activeSpaceId);
  const hiddenRoomIds = useUi(s => s.hiddenRoomIds);
  const goTo = useGoToTerminal();
  // App already polls these (react-query dedupes) — lets each pill name + dot its workspace exactly
  // like the card does (terminal ids, not workspace ids — a workspace can have several terminals).
  const { data: wsData } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const { data: spacesData } = useQuery({ queryKey: ["spaces"], queryFn: api.listSpaces });
  const attentionIds = new Set(useAttention().map(a => a.terminalId));
  const workingIds = new Set(useWorking().map(w => w.terminalId));

  const wsOf = (id: string) => wsData?.workspaces.find(w => w.id === id);
  // spaceId → column index, mirroring App.tsx's rooms stage so the taskbar matches what's on-screen:
  // a room with a real spaceId belongs only to that space; one with a null/unknown spaceId resolves
  // to the active column and follows you across spaces (same `?? activeIndex` fallback App uses).
  const spaceIndex = new Map<string, number>();
  (spacesData?.spaces ?? []).forEach((s, i) => spaceIndex.set(s.id, i));
  const activeIndex = spaceIndex.get(activeSpaceId) ?? 0;
  // Only the rooms living on the space you're looking at get a pill — switching spaces swaps the set.
  const rooms = openRooms.filter(r => (spaceIndex.get(wsOf(r.workspaceId)?.spaceId ?? "") ?? activeIndex) === activeIndex);
  if (rooms.length === 0) return null;

  // The front-most room on this space (highest z) is the one you're "in" — highlight it like a focused window.
  const focusedId = rooms.reduce((m, r) => (r.z > m.z ? r : m)).workspaceId;

  return (
    <div className="flex items-center gap-1 px-1.5 overflow-x-auto no-scrollbar">
      {rooms.map(r => {
        const ws = wsOf(r.workspaceId);
        const name = ws?.name ?? "…";
        const terms = ws?.terminals ?? [];
        const focused = r.workspaceId === focusedId;
        // Hidden by "Show Desktop": dim the pill (it's off-canvas) — clicking it brings the room back.
        const hidden = hiddenRoomIds.has(r.workspaceId);
        return (
          <button key={r.workspaceId} onClick={() => goTo(r.workspaceId)}
            title={ws ? `${ws.name} — ${ws.folder}${hidden ? " (hidden — click to show)" : ""}` : "Open room"}
            className={`flex items-center gap-1.5 h-[22px] max-w-[180px] px-2 rounded-[5px] border text-[12.5px] font-medium leading-none transition
              ${hidden ? "opacity-50" : ""}
              ${focused && !hidden ? "bg-elevated text-bright border-edge" : "bg-transparent text-fg border-transparent hover:text-bright hover:bg-elevated/60"}`}>
            <span className="truncate">{name}</span>
            {/* Same status dots as WorkspaceCard — attention (it wants you) outranks working (busy)
                outranks alive/dead; working shows as a same-color pulsing glow, attention as an
                amber blink, so the recolor only marks attention. */}
            <span className="flex gap-1 shrink-0">
              {terms.map(t => {
                const attn = attentionIds.has(t.id);
                const working = !attn && workingIds.has(t.id);
                const bg = attn ? "#fbbf24" : (t.alive || working) ? "rgb(var(--tr-success))" : "rgb(var(--tr-text-dim))";
                const dotTitle = attn ? `${t.title} — needs attention` : working ? `${t.title} — working…` : t.title;
                return <span key={t.id} title={dotTitle}
                  className={`inline-block w-1.5 h-1.5 rounded-full ${attn ? "tr-blink" : working ? "tr-working-dot" : ""}`}
                  style={{ background: bg }} />;
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}
