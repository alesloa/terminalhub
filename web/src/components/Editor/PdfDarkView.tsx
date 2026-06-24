import { useMemo, useRef, useState } from "react";
import { usePdfDoc, usePdfPageCanvases, useFitScale } from "../../hooks/usePdfDoc";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Applied to the page canvases ONLY (not the surrounding chrome): invert flips light↔dark, and
// hue-rotate(180) restores the hue of colored text/images so they don't come out colour-swapped.
const DARK_PAGE_FILTER = "invert(1) hue-rotate(180deg)";

/**
 * Dark reading view for a PDF: pdf.js renders each page to a canvas and the invert filter is applied
 * to the canvases alone, so the document reads as a clean dark theme while the app's own toolbar /
 * scroll area stay normal. Screen-only — the file is never modified. Used by PdfView when Dark is on;
 * the native viewer (with its search/print toolbar) is still there in light mode.
 */
export function PdfDarkView({ bytes }: { bytes: Uint8Array }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [userScale, setUserScale] = useState<number | null>(null);

  const { pageSizes, pdf, status } = usePdfDoc(bytes);
  const maxPw = useMemo(() => pageSizes.reduce((m, p) => Math.max(m, p.w), 0) || 612, [pageSizes]);
  const fitScale = useFitScale(scrollRef, maxPw);
  const scale = userScale ?? fitScale;
  const setCanvas = usePdfPageCanvases(pdf, pageSizes, scale);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#1c1f25]">
      <div className="shrink-0 flex items-center gap-1.5 border-b border-edge bg-code px-3 py-1 text-xs">
        <button onClick={() => setUserScale(clamp(scale - 0.2, 0.3, 3))} className="h-6 w-6 rounded text-fg hover:bg-edge" title="Zoom out">−</button>
        <span className="w-10 text-center tabular-nums text-dim">{Math.round(scale * 100)}%</span>
        <button onClick={() => setUserScale(clamp(scale + 0.2, 0.3, 3))} className="h-6 w-6 rounded text-fg hover:bg-edge" title="Zoom in">+</button>
        <button onClick={() => setUserScale(null)} className="h-6 px-2 rounded text-dim hover:text-fg" title="Fit to width">Fit</button>
        <span className="flex-1" />
        <span className="text-dim">Dark reading — your screen only</span>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-4">
        {pageSizes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-dim text-sm">
            {status === "error" ? "Could not open this PDF." : "Loading…"}
          </div>
        ) : (
          <div className="mx-auto flex flex-col items-center gap-4">
            {pageSizes.map((pg, i) => (
              <canvas
                key={i}
                ref={(el) => setCanvas(i, el)}
                style={{ width: pg.w * scale, height: pg.h * scale, filter: DARK_PAGE_FILTER }}
                className="block rounded shadow-lg"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
