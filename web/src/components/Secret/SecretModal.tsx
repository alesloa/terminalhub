import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type CSSProperties,
  type TransitionEventHandler,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { WinRect } from "../../store/ui";
import { spacesBarBottom } from "../../store/ui";
import { useDraggableWindow, type WindowHandle } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { fetchOnetimeConfig } from "./secretApi";
import { SecretForm } from "./SecretForm";
import { SecretResult, type SecretResultData } from "./SecretResult";

const RECT_KEY = "tr.secretRect"; // remembered window geometry (per-browser)
const MIN_W = 420,
  MIN_H = 480;
const DURATION = 300; // ms — grow-from-icon / minimize-to-icon animation

/** A tall, narrow box (the form is long), centered and clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth,
    vh = window.innerHeight;
  const w = Math.min(560, Math.round(vw * 0.6));
  const h = Math.min(720, Math.round(vh * 0.85));
  const top = spacesBarBottom() + 8;
  return {
    w,
    h,
    x: Math.max(8, Math.round((vw - w) / 2)),
    y: Math.max(top, Math.round((vh - h) / 2)),
  };
}

/** Restore saved geometry, clamped into the current viewport (it may have shrunk). */
function loadRect(): WinRect {
  try {
    const raw = localStorage.getItem(RECT_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<WinRect>;
      if (typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
        const vw = window.innerWidth,
          vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
        const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
        return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
      }
    }
  } catch {
    /* ignore corrupt/blocked storage */
  }
  return defaultRect();
}

/**
 * One-time secret composer: a free-floating, draggable, resizable window that creates a burnable,
 * encrypted link on the configured onetime (Yopass) instance. The server encrypts (host gpg) and
 * only ciphertext leaves the host for the onetime instance. Opening grows the window out of its tile;
 * Close minimizes it back into the tile before unmounting — the app's standard window convention.
 */
export const SecretModal = forwardRef<WindowHandle, { origin?: WinRect | null; onClose: () => void }>(
  function SecretModal({ origin, onClose }, ref) {
    const [seed] = useState(loadRect);
    const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H, undefined, undefined, "secret");
    const [result, setResult] = useState<SecretResultData | null>(null);

    // Instance config drives the real view/expiry bounds (and gates the optional controls).
    const { data: config, isLoading } = useQuery({
      queryKey: ["onetimeConfig"],
      queryFn: fetchOnetimeConfig,
      staleTime: Infinity,
    });

    // Grow-from-icon on open, minimize-to-icon on close (same trick as the room↔card animation).
    const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const [expanded, setExpanded] = useState(reduce);
    useEffect(() => {
      if (reduce) return;
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
      return () => cancelAnimationFrame(id);
    }, [reduce]);
    const handleClose = () => {
      if (reduce) {
        onClose();
        return;
      }
      setExpanded(false);
    };
    useImperativeHandle(ref, () => ({ close: handleClose }));
    const onTransitionEnd: TransitionEventHandler = (e) => {
      if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
    };

    // Remember geometry, debounced so a drag/resize doesn't hammer localStorage every frame.
    useEffect(() => {
      const t = window.setTimeout(() => {
        try {
          localStorage.setItem(RECT_KEY, JSON.stringify(rect));
        } catch {
          /* blocked */
        }
      }, 300);
      return () => window.clearTimeout(t);
    }, [rect]);

    const collapsed = origin
      ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
      : "scale(0.94)";
    const style: CSSProperties = {
      left: rect.x,
      top: rect.y,
      width: rect.w,
      height: rect.h,
      ...(reduce
        ? {}
        : {
            transformOrigin: origin ? "0 0" : "50% 50%",
            transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
            opacity: expanded ? 1 : 0,
            transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
            willChange: "transform, opacity",
          }),
    };

    return (
      <div
        onTransitionEnd={onTransitionEnd}
        style={style}
        className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl"
      >
        <div
          onPointerDown={beginDrag}
          className="h-8 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none"
        >
          <div className="font-semibold">One-time secret</div>
          <div className="flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={handleClose} title="Close" className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-5">
          {isLoading || !config ? (
            <div className="h-full flex items-center justify-center text-dim text-sm">loading…</div>
          ) : !config.enabled ? (
            <div className="h-full flex items-center justify-center text-center text-dim text-sm px-6">
              Secret links aren't configured. Set <code className="text-fg">ONETIME_BASE</code> to a
              Yopass-compatible instance on the server to enable them.
            </div>
          ) : result ? (
            <SecretResult data={result} onReset={() => setResult(null)} />
          ) : (
            <SecretForm config={config} onCreated={setResult} />
          )}
        </div>

        <ResizeHandles onStart={beginResize} />
      </div>
    );
  },
);
