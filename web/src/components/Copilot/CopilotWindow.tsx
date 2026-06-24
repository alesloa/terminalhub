import { useEffect, useState, type CSSProperties, type TransitionEventHandler } from "react";
import type { WinRect } from "../../store/ui";
import { useUi, spacesBarBottom } from "../../store/ui";
import { useDraggableWindow } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { useCopilotSettings } from "../../hooks/useCopilot";
import { CopilotChat } from "./CopilotChat";
import { CopilotSkills } from "./CopilotSkills";
import { CopilotSchedules } from "./CopilotSchedules";
import { EnginePicker } from "./EnginePicker";

type Tab = "chat" | "skills" | "schedules";

const RECT_KEY = "tr.copilotRect";
const MIN_W = 360, MIN_H = 440;
const DURATION = 300; // ms — grow-from-icon / minimize-to-icon

// A tall, narrow assistant panel anchored to the bottom-right (near the canvas orb it grows from).
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(440, Math.round(vw * 0.9));
  const h = Math.min(680, Math.round(vh * 0.82));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, vw - w - 24), y: Math.max(top, vh - h - 24) };
}

// Clamp a saved rect so the WHOLE window lands inside the current viewport, below the spaces bar (8px
// margins). Shrinking the browser can leave the saved position partly or entirely off-screen — the old
// clamp only kept ~80px on screen, so after a resize the window opened almost entirely out of view. This
// pins all four edges in, shrinking the size first if the viewport is now smaller than the saved window.
function fitOnScreen(r: WinRect): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const top = spacesBarBottom() + 8;
  const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
  const h = Math.max(MIN_H, Math.min(r.h, vh - top - 8));
  const x = Math.max(8, Math.min(r.x, vw - w - 8));
  const y = Math.max(top, Math.min(r.y, vh - h - 8));
  return { w, h, x, y };
}

function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        return fitOnScreen(r as WinRect);
      }
    }
  } catch { /* ignore corrupt/blocked storage */ }
  return defaultRect();
}

// The Copilot window. Store-signalled like SystemMonitor: it grows out of whichever opener (canvas
// orb or TopBar tile) set copilotOrigin, and a second press of that opener bumps copilotCloseSeq to
// run the SAME minimize-to-icon close instead of an instant unmount.
export function CopilotWindow({ onClose }: { onClose: () => void }) {
  const settings = useCopilotSettings();
  const [tab, setTab] = useState<Tab>("chat");
  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "copilot");

  const [origin] = useState<WinRect | null>(() => useUi.getState().copilotOrigin);
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // A second press of the orb/tile bumps copilotCloseSeq → run the animated close.
  const closeSeq = useUi((s) => s.copilotCloseSeq);
  const [seenSeq, setSeenSeq] = useState(closeSeq);
  useEffect(() => {
    if (closeSeq === seenSeq) return;
    setSeenSeq(closeSeq);
    handleClose();
  }, [closeSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* blocked */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-2xl overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      <div onPointerDown={beginDrag}
        className="relative h-12 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white"><SparkIcon /></div>
          <div className="leading-tight">
            <div className="font-semibold text-sm">Copilot</div>
            <EnginePicker />
          </div>
        </div>
        <button onClick={handleClose} title="Close" onPointerDown={(e) => e.stopPropagation()}
          className="w-7 h-7 rounded-lg hover:bg-elevated text-muted hover:text-bright flex items-center justify-center">✕</button>
      </div>

      {settings.data && !settings.data.enabled ? (
        <div className="flex-1 flex items-center justify-center text-center text-muted text-sm px-6">
          The Copilot is disabled. Enable it in Settings → Copilot.
        </div>
      ) : (
        <>
          <div className="shrink-0 flex items-center gap-1 px-3 pt-2 border-b border-edge">
            <TabBtn label="Chat" active={tab === "chat"} onClick={() => setTab("chat")} />
            <TabBtn label="Skills" active={tab === "skills"} onClick={() => setTab("skills")} />
            <TabBtn label="Schedules" active={tab === "schedules"} onClick={() => setTab("schedules")} />
          </div>
          {/* Keep Chat mounted across tab switches so its socket + transcript survive. */}
          <div className="flex-1 min-h-0">
            <div className={tab === "chat" ? "h-full" : "hidden"}><CopilotChat /></div>
            <div className={tab === "skills" ? "h-full" : "hidden"}><CopilotSkills /></div>
            <div className={tab === "schedules" ? "h-full" : "hidden"}>{tab === "schedules" && <CopilotSchedules />}</div>
          </div>
        </>
      )}

      <ResizeHandles onStart={beginResize} />
    </div>
  );
}

const SparkIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" /></svg>);

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-t-lg -mb-px border-b-2 ${active ? "border-blue-500 text-bright" : "border-transparent text-muted hover:text-fg"}`}>
      {label}
    </button>
  );
}
