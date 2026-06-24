import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useUi, rectOf } from "../store/ui";
import { PEACOCK_BAR, PEACOCK_SEAM } from "../lib/peacock";
import { RoomTaskbar } from "./RoomTaskbar";
import { ShowDesktopButton } from "./ShowDesktopButton";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const KIB = 1024;

const pct = (n: number) => `${Math.round(n)}%`;
// RAM as "used/total GB" — GiB under the hood, labeled "GB" to match the reference readout.
const gib = (used: number, total: number) => `${(used / GIB).toFixed(2)}/${(total / GIB).toFixed(2)} GB`;
// Network throughput, humanized like the screenshot: MB/s with one decimal, KB/s whole.
function rate(bytesPerSec: number): string {
  if (bytesPerSec >= MIB) return `${(bytesPerSec / MIB).toFixed(1)} MB/s`;
  if (bytesPerSec >= KIB) return `${Math.round(bytesPerSec / KIB)} KB/s`;
  return `${Math.round(bytesPerSec)} B/s`;
}

/**
 * The CPU / RAM / network readout. A button — clicking opens the shared System Monitor modal.
 * Used standalone in the room's BottomBar and wrapped by SystemStatsBar on the home canvas.
 * Polls every 2s and fails quietly (renders dashes) so it can never crash its host.
 */
export function SystemStats({ className = "" }: { className?: string }) {
  const setMonitorOpen = useUi(s => s.setMonitorOpen);
  const { data } = useQuery({ queryKey: ["systemStats"], queryFn: api.systemStats, refetchInterval: 2000 });
  const s = data?.stats;
  return (
    <button onClick={(e) => setMonitorOpen(true, rectOf(e.currentTarget))} title="Open System Monitor"
      className={`flex items-center gap-3.5 px-2 h-full text-muted hover:text-fg cursor-pointer tabular-nums ${className}`}>
      <span className="flex items-center gap-1.5" title="CPU">
        <MonitorIcon /><span>{s ? pct(s.cpu.percent) : "—"}</span>
      </span>
      <span className="flex items-center gap-1.5" title="Memory">
        <DiskIcon /><span>{s ? `${gib(s.mem.used, s.mem.total)}, ${pct(s.mem.percent)}` : "—"}</span>
      </span>
      <span className="flex items-center gap-1.5" title="Network ↑upload ↓download">
        <GlobeIcon /><span>{s ? `↑${rate(s.net.txBytesPerSec)} ↓${rate(s.net.rxBytesPerSec)}` : "—"}</span>
      </span>
    </button>
  );
}

/**
 * Just the overall CPU + RAM readout — no network chip, not clickable. Lives centered in the
 * System Monitor's title bar. Shares the same 2s-polled ["systemStats"] query as the strip
 * (react-query dedupes by key), so it adds no extra polling.
 */
export function CpuRamReadout({ className = "" }: { className?: string }) {
  const { data } = useQuery({ queryKey: ["systemStats"], queryFn: api.systemStats, refetchInterval: 2000 });
  const s = data?.stats;
  return (
    <div className={`flex items-center gap-3.5 text-muted tabular-nums whitespace-nowrap ${className}`}>
      <span className="flex items-center gap-1.5" title="Overall CPU usage">
        <MonitorIcon /><span>{s ? pct(s.cpu.percent) : "—"}</span>
      </span>
      <span className="flex items-center gap-1.5" title="Overall memory usage">
        <DiskIcon /><span>{s ? `${gib(s.mem.used, s.mem.total)}, ${pct(s.mem.percent)}` : "—"}</span>
      </span>
    </div>
  );
}

// Height of the pinned home-canvas stats strip. Exported so a maximized room can stop short of it
// (Room.tsx) instead of covering the readout. Single source of truth — also drives the bar itself.
export const STATS_BAR_HEIGHT = 28;

/** Permanent home-canvas strip: the stats readout pinned to the very bottom, themed like the room bars.
 *  `relative z-[100]` lifts it above everything else (rooms z-40, modals z-[80], toasts z-50) so nothing
 *  can ever paint over the readout — it stays in normal flow, so the canvas still reserves its height. */
export function SystemStatsBar() {
  // Three-zone strip: the open-room taskbar pinned left, the stats readout dead-centered (the two
  // equal flex-1 side tracks keep it centered no matter how wide the taskbar gets — the taskbar
  // clips/scrolls within its own track instead of pushing the stats off-center), an empty right
  // track to balance. Each side is independently toggleable (Settings → Workbench). The strip itself
  // stays mounted so its reserved height (STATS_BAR_HEIGHT, which rooms/dock anchor to) never shifts;
  // hiding the stats UNMOUNTS SystemStats, so its 2s CPU/RAM/network poll genuinely stops.
  const showStats = useUi(s => s.showSystemStats);
  const showTaskbar = useUi(s => s.showRoomTaskbar);
  return (
    <div style={{ background: PEACOCK_BAR, borderColor: PEACOCK_SEAM, height: STATS_BAR_HEIGHT }}
      className="relative z-[100] shrink-0 border-t flex items-center text-xs">
      <div className="flex-1 min-w-0 flex justify-start">{showTaskbar && <RoomTaskbar />}</div>
      {showStats && <SystemStats />}
      {/* Bottom-right: the Show Desktop toggle, balancing the strip (its flex-1 track keeps SystemStats centered). */}
      <div className="flex-1 min-w-0 flex justify-end items-center"><ShowDesktopButton /></div>
    </div>
  );
}

function MonitorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="3.5" width="19" height="13" rx="1.6" />
      <path d="M8.5 20.5h7" />
      <path d="M12 16.5v4" />
    </svg>
  );
}

function DiskIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 3.5h11l4 4v13a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
      <path d="M7.5 3.5v6h7v-6" />
      <rect x="7.5" y="13.5" width="9" height="6" rx="0.6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9s1.3-6.4 3.8-9z" />
    </svg>
  );
}
