import { useQuery } from "@tanstack/react-query";
import { useUi } from "../../store/ui";
import { api } from "../../api/client";
import type { Workspace } from "../../api/types";
import { PEACOCK_BAR, PEACOCK_SEAM } from "../../lib/peacock";
import { StagePreview } from "./StagePreview";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// The real top-level file listing of the room's folder, drawn tiny in the mini sidebar so the
// thumbnail shows what the room's Explorer actually shows. Real data (api.fsList), cached and only
// fetched while the dock is open and the sidebar is on the Explorer view.
function MiniExplorer({ folder, enabled }: { folder: string; enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ["miniFs", folder],
    queryFn: () => api.fsList(folder),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const entries = [...(data?.entries ?? [])]
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))
    .slice(0, 18);
  return (
    <div className="absolute inset-0 overflow-hidden px-0.5 py-px">
      {entries.map(e => (
        <div key={e.path} className="flex items-center gap-0.5 truncate leading-[1.3]" style={{ fontSize: 5 }}>
          <span className={e.type === "dir" ? "text-accent" : "text-dim"}>{e.type === "dir" ? "▸" : "·"}</span>
          <span className={`truncate ${e.type === "dir" ? "text-bright" : "text-fg"}`}>{e.name}</span>
        </div>
      ))}
    </div>
  );
}

// A scaled, faithful thumbnail of a whole room WINDOW — not just a terminal. It reproduces the room's
// real chrome from live state: the peacock-tinted title bar + name (the workspace's accent color, same
// tint the real window uses), the activity rail, the sidebar (when open — sized to the real sidebar
// width and showing the room's real top-level files), the editor area with the room's real open-file
// tabs, and the terminal dock (height ∝ the real dock height) holding the live capture-pane render.
// Every proportion/label is real room state — nothing invented. When a room is off-stage (spotlight)
// it isn't mounted, so it hasn't reported its layout: we fall back to neutral window proportions, and
// the terminal capture still polls server-side so the thumbnail stays live.
// One title-bar status dot per terminal (mirrors the bottom stats bar / workspace card). Unlike the
// bottom bar, an alive-but-idle terminal here is GRAY (not green) — only a working agent is green, and a
// terminal that wants you is amber.
export type TermDot = { id: string; attn: boolean; working: boolean; title: string };

export function StageMiniWindow({
  ws, previewTerminalId, enabled, termDots,
}: {
  ws: Workspace;
  previewTerminalId: string | null;
  enabled: boolean;
  termDots: TermDot[];
}) {
  const view = useUi(s => s.roomViewByWorkspace[ws.id]);
  const editor = useUi(s => s.roomEditorByWorkspace[ws.id]);
  const rect = useUi(s => s.roomRectByWorkspace[ws.id]);
  const maximized = useUi(s => s.roomMaximized[ws.id]);
  const pos = useUi(s => s.sidebarPosition);

  // Room footprint, for turning the real px panel sizes into thumbnail percentages. A maximized (or
  // not-yet-reported) room fills the viewport; a floating one uses its reported rect.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const W = !maximized && rect?.w ? rect.w : vw;
  const H = !maximized && rect?.h ? rect.h : vh;

  const sidebarPct = view?.leftOpen ? clamp((view.sidebarWidth / W) * 100, 14, 36) : 0;
  const termListPct = view?.rightOpen ? clamp((view.terminalListWidth / W) * 100, 10, 28) : 0;
  const dockPct = clamp(((view?.dockHeight ?? H * 0.32) / H) * 100, 18, 58);

  // Peacock accent — the workspace's real color (card color wins, like the room frame). Set as the
  // --peacock var so the shared color-mix tints (PEACOCK_BAR/SEAM) wash the chrome exactly as the
  // real window does. Absent → the mixes fall back to the dark default (uncolored room looks default).
  const peacock = ws.cardColor ?? ws.color ?? null;
  const sideRail = pos === "left" || pos === "right"; // activity bar lives as an edge rail
  const tabs = (editor?.openFiles ?? []).slice(0, 4);
  const showExplorer = sidebarPct > 0 && view?.activeView === "explorer";

  return (
    <div
      className="absolute inset-0 flex flex-col bg-canvas select-none"
      style={peacock ? ({ ["--peacock" as string]: peacock } as React.CSSProperties) : undefined}
    >
      {/* title bar — peacock-tinted (shows the accent color), with the dot + real workspace name */}
      <div
        className="h-[24px] shrink-0 flex items-center gap-1.5 px-2 border-b"
        style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }}
      >
        <span className="flex-1 min-w-0 truncate text-bright font-semibold leading-none" style={{ fontSize: 13 }}>
          {ws.name}
        </span>
        {/* per-terminal status dots — gray idle, green working, amber attention (count = #terminals) */}
        {termDots.length > 0 && (
          <span className="flex gap-1 shrink-0">
            {termDots.map(d => (
              <span
                key={d.id}
                title={d.attn ? `${d.title} — needs attention` : d.working ? `${d.title} — working…` : d.title}
                className={`inline-block w-1.5 h-1.5 rounded-full ${d.attn ? "tr-blink" : d.working ? "tr-working-dot" : ""}`}
                style={{ background: d.attn ? "#fbbf24" : d.working ? "rgb(var(--tr-success))" : "rgb(var(--tr-text-dim))" }}
              />
            ))}
          </span>
        )}
      </div>

      {/* body: [rail] [sidebar] [ editor / dock ] [rail] */}
      <div className="flex-1 min-h-0 flex">
        {sideRail && pos === "left" && (
          <div className="w-1.5 shrink-0 border-r" style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }} />
        )}
        {sidebarPct > 0 && (
          <div className="relative shrink-0 bg-panel border-r border-edge" style={{ width: `${sidebarPct}%` }}>
            {showExplorer && <MiniExplorer folder={ws.folder} enabled={enabled} />}
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          {/* editor area: real open-file tabs + an empty editor surface (content can't be captured) */}
          <div className="flex-1 min-h-0 flex flex-col bg-code">
            {tabs.length > 0 && (
              <div className="h-2.5 shrink-0 flex items-stretch bg-elevated/70 border-b border-edge">
                {tabs.map((f, i) => (
                  <div
                    key={f.path}
                    className={`px-1 flex items-center border-r border-edge truncate ${i === 0 ? "bg-canvas text-bright" : "text-dim"}`}
                    style={{ fontSize: 5, maxWidth: 44 }}
                  >
                    {f.name}
                  </div>
                ))}
              </div>
            )}
            <div className="flex-1 min-h-0" />
          </div>

          {/* terminal dock: optional terminal-list strip + the live terminal capture */}
          <div className="shrink-0 flex border-t border-edge" style={{ height: `${dockPct}%` }}>
            {termListPct > 0 && <div className="shrink-0 bg-panel border-r border-edge" style={{ width: `${termListPct}%` }} />}
            <div className="flex-1 min-w-0 relative">
              <StagePreview terminalId={previewTerminalId} enabled={enabled} />
            </div>
          </div>
        </div>

        {sideRail && pos === "right" && (
          <div className="w-1.5 shrink-0 border-l" style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM }} />
        )}
      </div>
    </div>
  );
}
