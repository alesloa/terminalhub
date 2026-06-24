import { useCallback, useRef, useState } from "react";

/**
 * A small modal to draw a signature with the pointer (mouse / trackpad / touch). Strokes are black on
 * a transparent canvas; on "Use signature" the ink is cropped to its bounding box and handed back as a
 * PNG data URL plus its natural pixel size (so the caller can place it at the right aspect ratio).
 */
export function SignaturePad({ onDone, onClose }: {
  onDone: (dataUrl: string, naturalW: number, naturalH: number) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  // Ink bounding box, grown as the user draws — used to crop on export.
  const bbox = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  const grow = (x: number, y: number) => {
    const b = bbox.current;
    bbox.current = b
      ? { minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }
      : { minX: x, minY: y, maxX: x, maxY: y };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    last.current = p;
    grow(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = "#101317";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    grow(p.x, p.y);
    if (!hasInk) setHasInk(true);
  };
  const up = () => { drawing.current = false; last.current = null; };

  const clear = useCallback(() => {
    const c = canvasRef.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    bbox.current = null;
    setHasInk(false);
  }, []);

  const use = () => {
    const c = canvasRef.current, b = bbox.current;
    if (!c || !b) return;
    const pad = 8;
    const x = Math.max(0, b.minX - pad), y = Math.max(0, b.minY - pad);
    const w = Math.min(c.width, b.maxX + pad) - x, h = Math.min(c.height, b.maxY + pad) - y;
    if (w <= 0 || h <= 0) return;
    const crop = document.createElement("canvas");
    crop.width = Math.ceil(w);
    crop.height = Math.ceil(h);
    crop.getContext("2d")!.drawImage(c, x, y, w, h, 0, 0, crop.width, crop.height);
    onDone(crop.toDataURL("image/png"), crop.width, crop.height);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50" onPointerDown={onClose}>
      <div className="w-[640px] max-w-[92%] rounded-lg border border-edge bg-panel p-4 shadow-xl" onPointerDown={(e) => e.stopPropagation()}>
        <div className="mb-2 text-sm text-fg">Draw your signature</div>
        <canvas
          ref={canvasRef}
          width={1200}
          height={360}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          className="block w-full touch-none rounded border border-edge bg-white"
          style={{ aspectRatio: "1200 / 360" }}
        />
        <div className="mt-3 flex items-center justify-end gap-2 text-xs">
          <button onClick={clear} className="h-7 px-3 rounded text-fg hover:text-bright">Clear</button>
          <button onClick={onClose} className="h-7 px-3 rounded text-fg hover:text-bright">Cancel</button>
          <button onClick={use} disabled={!hasInk}
            className="h-7 px-3 rounded bg-elevated text-bright hover:bg-edge disabled:opacity-50">
            Use signature
          </button>
        </div>
      </div>
    </div>
  );
}
