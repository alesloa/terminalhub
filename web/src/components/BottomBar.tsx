import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "../api/types";
import { api } from "../api/client";
import { ColorPicker, WS_L_MIN } from "./TerminalContextMenu";
import { PEACOCK_BAR, PEACOCK_SEAM } from "../lib/peacock";
import { ACTIVITY_ITEMS } from "./Sidebar/ActivityBar";
import { MicButton } from "./MicButton";
import { useRoom } from "../store/room";
import { useUi, rectOf } from "../store/ui";

// Accent the room falls back to with no custom color (matches the card/menu default).
const DEFAULT_ACCENT = "rgb(var(--tr-accent))";
// Active (open-view) activity-icon tint. Idle icons use the themed `text-muted` class instead of a
// fixed grey, so they stay legible on light themes too (a hardcoded light grey vanished on them).
const ICON_ACTIVE = "#70b8ff";

export function BottomBar({ workspace }: { workspace: Workspace }) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const activeView = useRoom(s => s.activeView);
  const leftOpen = useRoom(s => s.leftOpen);
  const selectView = useRoom(s => s.selectView);
  // The view icons live here in "bottom" mode. left/right show a persistent rail at the workspace
  // edge (always reachable), so the bottom never duplicates them. "top" puts the bar inside the
  // panel, which clips when collapsed — so the icons resurface here while the panel is hidden.
  const sidebarPosition = useUi(s => s.sidebarPosition);
  // The dictation mic docks here when the user picks "bottom" (Settings → Appearance); otherwise it
  // rides in the room's top-bar window controls.
  const micPosition = useUi(s => s.micPosition);
  const showViewIcons = sidebarPosition === "bottom" || (sidebarPosition === "top" && !leftOpen);
  const setPreviewColor = useUi(s => s.setPreviewColor);
  const clearPreviewColor = useUi(s => s.clearPreviewColor);
  const openWizard = useUi(s => s.openSpaceWizard);
  // Persist to `cardColor` — the unified field the card border AND room peacock both read first
  // (`cardColor ?? color`). Writing the legacy `color` here was the bug: a cardColor set from the
  // canvas card picker shadowed it, so this picker looked dead (pink chosen, border stayed blue).
  const color = useMutation({
    mutationFn: (c: string | null) => api.updateWorkspace(workspace.id, { cardColor: c }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  // Commit a picked color: optimistically patch cardColor (room repaints with no flicker), drop the
  // live preview, then persist — same sequence as Canvas.commitCardColor so both pickers match.
  const commit = (c: string | null) => {
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
      old ? { ...old, workspaces: old.workspaces.map(w => w.id === workspace.id ? { ...w, cardColor: c } : w) } : old);
    clearPreviewColor(workspace.id);
    color.mutate(c);
  };
  // Drop any live preview if the bar unmounts mid-drag (commit clears it on release).
  useEffect(() => () => clearPreviewColor(workspace.id), [clearPreviewColor, workspace.id]);

  // Dismiss the picker on outside-click / Escape (deferred a frame so the opening click
  // doesn't immediately close it, like the context menus).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const raf = requestAnimationFrame(() => window.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }}
      className="h-7 shrink-0 border-t flex items-center justify-between px-1 text-xs text-dim">
      {/* Activity views, bottom-left. Click toggles the left panel for that view; active icon tints
          blue. Hidden when the switcher lives in the panel (left/right/top) and the panel is open. */}
      <div className="flex items-center">
        {showViewIcons && ACTIVITY_ITEMS.map(it => {
          const active = leftOpen && activeView === it.id;
          return (
            <button key={it.id} title={it.label} onClick={() => selectView(it.id)}
              className={`flex items-center justify-center w-7 h-7 rounded hover:bg-white/10 cursor-pointer [&_svg]:h-4 [&_svg]:w-4 ${active ? "" : "text-muted hover:text-fg"}`}
              style={active ? { color: ICON_ACTIVE } : undefined}>
              {it.icon}
            </button>
          );
        })}
      </div>
      {/* Right cluster: workspace-setup wizard, the dictation mic (when docked here), the Peacock swatch. */}
      <div className="flex items-center gap-1">
      {/* Per-workspace setup: skills / commands / MCP servers / env / rules for THIS workspace, seeded
          additively over its space's config. Grows the wizard window out of this button. */}
      <button onClick={(e) => openWizard({ mode: "workspace", spaceId: null, workspaceId: workspace.id, origin: rectOf(e.currentTarget) })}
        title="Workspace setup — add skills, commands, MCP servers…"
        className="flex items-center justify-center w-7 h-7 rounded hover:bg-white/10 cursor-pointer text-muted hover:text-fg">
        <span className="codicon codicon-tools text-[13px]" aria-hidden />
      </button>
      {micPosition === "bottom" && <MicButton />}
      {/* Peacock swatch: opens the shared picker and recolors the whole room chrome. */}
      <div ref={ref} className="relative flex items-center">
        <button onClick={() => setOpen(o => !o)} title="Editor color (Peacock)"
          className="flex items-center px-1 py-0.5 rounded hover:bg-white/10 cursor-pointer">
          {/* Four-color palette icon — the affordance that this opens a color picker. */}
          <span className="grid grid-cols-2 grid-rows-2 gap-[1.5px] w-3.5 h-3.5">
            <span className="rounded-[1.5px]" style={{ background: "#f35325" }} />
            <span className="rounded-[1.5px]" style={{ background: "#81bc06" }} />
            <span className="rounded-[1.5px]" style={{ background: "#05a6f0" }} />
            <span className="rounded-[1.5px]" style={{ background: "#ffba08" }} />
          </span>
        </button>
        {open && (
          <div className="absolute bottom-full right-0 mb-2 z-50">
            <ColorPicker current={workspace.cardColor ?? workspace.color ?? null} defaultColor={DEFAULT_ACCENT} minLight={WS_L_MIN}
              onPreview={(c) => setPreviewColor(workspace.id, c)} onPick={commit} />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
