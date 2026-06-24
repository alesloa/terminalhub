import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { base64ToBytes } from "../../lib/bytes";

// The fill & sign editor (pdf.js + pdf-lib) and the dark reader (pdf.js) are lazy-loaded so plain
// light viewing — the common case — never pulls in pdf.js at all.
const PdfFillSign = lazy(() => import("./PdfFillSign"));
const PdfDarkView = lazy(() => import("./PdfDarkView").then((m) => ({ default: m.PdfDarkView })));

function fmtSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
}

// Light-vs-dark reading preference, persisted per-browser.
const PDF_DARK_KEY = "tr.pdfDark";

/**
 * The rich view for a .pdf, with a moon/sun toggle for dark reading and a View / Fill & sign switch:
 *
 *  - light "view" (default): the browser's built-in PDF viewer in a plain <iframe> fed a blob: URL of
 *    the file's bytes. Fully faithful — exact layout, fonts, embedded images, native zoom/search/print
 *    — and read-only. (A data: URL won't work — Chrome blocks PDFs in a frame from data: URIs.)
 *  - dark "view": PdfDarkView renders the pages with pdf.js and inverts ONLY the page canvases, so the
 *    document reads as a dark theme while the app chrome stays normal. Screen-only — the file is never
 *    modified, so a PDF you send still opens light for the recipient.
 *  - "fill": a fill & sign editor (lazy-loaded) — place text, checkmarks, and a drawn signature on the
 *    page, baked into the document only when you press Save. Additive, never auto-saved.
 *
 * Clicking a .pdf in the explorer opens this (kind: "pdf-preview") instead of the "binary file" message.
 */
export function PdfView({ path, name }: { path: string; name: string }) {
  const [mode, setMode] = useState<"view" | "fill">("view");
  const [dark, setDark] = useState(() => { try { return localStorage.getItem(PDF_DARK_KEY) === "1"; } catch { return false; } });
  const toggleDark = () => setDark((d) => { const n = !d; try { localStorage.setItem(PDF_DARK_KEY, n ? "1" : "0"); } catch { /* private mode */ } return n; });

  const { data, isLoading, error } = useQuery({
    queryKey: ["fs-bytes", path],
    queryFn: () => api.fsReadFileBytes(path),
    staleTime: 10_000,
    enabled: mode === "view", // the editor reads the bytes itself; don't double-fetch
  });

  // Wrap the decoded bytes in an object URL for the native viewer; revoke it when the bytes change
  // or the tab unmounts so blobs don't pile up.
  const url = useMemo(() => {
    if (!data?.dataBase64) return null;
    // atob-backed bytes are always plain-ArrayBuffer (never SharedArrayBuffer), so the BlobPart cast
    // is sound and copy-free — same pattern as reqBinary in api/client.ts.
    const bytes = base64ToBytes(data.dataBase64) as Uint8Array<ArrayBuffer>;
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  }, [data?.dataBase64]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  // Decoded bytes for the pdf.js dark reader (same query data — no extra fetch).
  const bytes = useMemo(() => (data?.dataBase64 ? base64ToBytes(data.dataBase64) : null), [data?.dataBase64]);

  const seg = (active: boolean) =>
    `h-6 px-2.5 rounded ${active ? "bg-edge text-bright" : "text-fg hover:text-bright"}`;

  return (
    <div className="h-full min-h-0 flex flex-col bg-canvas">
      <div className="shrink-0 flex items-center gap-2 border-b border-edge bg-code px-3 py-1">
        <div className="min-w-0 flex-1 truncate text-xs text-dim">{name}</div>
        {mode === "view" && (
          <button onClick={toggleDark}
            title={dark ? "Switch to light view" : "Dark reading mode — your screen only; the file stays light for anyone you send it to"}
            aria-label={dark ? "Light view" : "Dark view"}
            className={`w-7 h-7 inline-flex items-center justify-center rounded ${dark ? "bg-edge text-bright" : "text-fg hover:text-bright"}`}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        )}
        <div className="flex items-center rounded bg-elevated p-0.5 text-xs">
          <button onClick={() => setMode("view")} title="Read the PDF (native viewer)" className={seg(mode === "view")}>View</button>
          <button onClick={() => setMode("fill")} title="Add text, checkmarks, and a signature" className={seg(mode === "fill")}>Fill &amp; sign</button>
        </div>
      </div>

      {mode === "fill" ? (
        <Suspense fallback={<Centered>Loading editor…</Centered>}>
          <PdfFillSign path={path} name={name} />
        </Suspense>
      ) : isLoading ? (
        <Centered>Loading…</Centered>
      ) : error ? (
        <Centered>Couldn’t read this PDF.</Centered>
      ) : data?.tooLarge ? (
        <Centered>PDF is too large to preview.</Centered>
      ) : !bytes || !url ? (
        <Centered>Couldn’t read this PDF.</Centered>
      ) : dark ? (
        <Suspense fallback={<Centered>Loading…</Centered>}>
          <PdfDarkView bytes={bytes} />
        </Suspense>
      ) : (
        <>
          <iframe title={name} src={url} className="flex-1 min-h-0 w-full bg-white" />
          <div className="shrink-0 flex items-center gap-3 h-7 px-3 text-xs text-dim border-t border-edge bg-panel">
            <span className="truncate">{name}</span>
            {data && <span>{fmtSize(data.size)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="h-full flex items-center justify-center text-dim text-sm">{children}</div>;
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
