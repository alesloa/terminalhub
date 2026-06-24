import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// pdf.js needs its worker; Vite resolves the .mjs to a real URL via ?url and bundles it. Set once
// here, the single place the app touches pdf.js, so the reader and the editor share one setup.
// IMPORTANT: use the *legacy* build, not the default `pdfjs-dist`. The modern build calls
// Map/WeakMap.prototype.getOrInsertComputed (a brand-new TC39 method) with no polyfill, so
// page.render() throws in browsers that lack it and pages come up blank. Legacy ships the polyfill.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfSize = { w: number; h: number };
export type PdfStatus = "idle" | "loading" | "ready" | "error";

const FIT_MAX_COL = 1000; // cap fit-to-width to a readable column so a page doesn't balloon on a wide pane
const MAX_CANVAS_DIM = 3000; // cap the canvas buffer's long side so a big zoom can't fail to allocate

/**
 * Load a PDF from raw bytes with pdf.js, re-loading whenever `bytes` changes (e.g. after a Save bakes
 * new bytes). Returns the document, each page's intrinsic size in PDF points, and a load status.
 */
export function usePdfDoc(bytes: Uint8Array | null): { pdf: PDFDocumentProxy | null; pageSizes: PdfSize[]; status: PdfStatus } {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PdfSize[]>([]);
  const [status, setStatus] = useState<PdfStatus>("idle");

  useEffect(() => {
    if (!bytes) { setStatus("idle"); return; }
    let disposed = false;
    setStatus("loading");
    const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
    (async () => {
      try {
        const doc = await task.promise;
        if (disposed) return;
        const sizes: PdfSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (disposed) return;
        setPdf(doc);
        setPageSizes(sizes);
        setStatus("ready");
      } catch { if (!disposed) setStatus("error"); }
    })();
    return () => { disposed = true; void task.destroy(); }; // destroys the document + its worker
  }, [bytes]);

  return { pdf, pageSizes, status };
}

/**
 * Paint each page of `pdf` into a registered canvas at `scale` (× dpr for crispness, CSS-sized back
 * down by the caller). Returns a ref callback to attach each page's canvas by index.
 */
export function usePdfPageCanvases(pdf: PDFDocumentProxy | null, pageSizes: PdfSize[], scale: number) {
  const canvasMap = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const setCanvas = useCallback((i: number, el: HTMLCanvasElement | null) => {
    if (el) canvasMap.current.set(i, el);
    else canvasMap.current.delete(i);
  }, []);

  useEffect(() => {
    if (!pdf || pageSizes.length === 0) return;
    let cancelled = false;
    let active: { cancel: () => void } | null = null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    (async () => {
      for (let i = 0; i < pageSizes.length; i++) {
        if (cancelled) return;
        const canvas = canvasMap.current.get(i);
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) continue;
        const page = await pdf.getPage(i + 1);
        if (cancelled) return;
        const pg = pageSizes[i];
        // Render at scale×dpr for crispness, but cap the buffer's long side — a huge zoom across many
        // pages otherwise allocates gigabytes and the render fails silently into a blank canvas. The
        // CSS size (set by the caller) is unaffected, so only extreme zoom loses a little sharpness.
        const renderScale = Math.min(scale * dpr, MAX_CANVAS_DIM / Math.max(pg.w, pg.h));
        const vp = page.getViewport({ scale: renderScale });
        canvas.width = vp.width;
        canvas.height = vp.height;
        const task = page.render({ canvasContext: ctx, viewport: vp, canvas });
        active = task;
        await task.promise.catch(() => {}); // a cancelled render rejects — ignore
      }
    })();
    return () => { cancelled = true; try { active?.cancel(); } catch { /* already settled */ } };
  }, [pdf, pageSizes, scale]);

  return setCanvas;
}

/** Live width of an element via ResizeObserver, for fit-to-width page scaling. */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>, initial = 800): number {
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Fit-to-width scale for a page `maxPw` points wide inside `ref`, capped to a readable column (so a
 *  page never blows up to fill an ultra-wide pane) and to [0.3, 2]. */
export function useFitScale<T extends HTMLElement>(ref: RefObject<T | null>, maxPw: number): number {
  const w = useElementWidth(ref);
  return useMemo(() => {
    const s = (Math.min(w, FIT_MAX_COL) - 32) / (maxPw || 612);
    return Math.max(0.3, Math.min(2, s));
  }, [w, maxPw]);
}
