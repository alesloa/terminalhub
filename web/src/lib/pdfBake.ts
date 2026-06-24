import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { dataUrlToBytes } from "./bytes";

/**
 * A fill-&-sign annotation placed on a PDF page. Positions/sizes are stored as ratios of the page
 * box (not pixels), so they're independent of the zoom the page was rendered at — the same numbers
 * drive the on-screen overlay (PdfFillSign) and the baked output (bakePdf below). `x`/`y` are the
 * annotation's TOP-LEFT as a fraction of page width/height, measured y-DOWN from the page top (screen
 * convention); bakePdf flips Y for PDF's bottom-left origin.
 */
export type PdfAnno =
  | { id: string; page: number; xr: number; yr: number; type: "text"; text: string; sizeR: number; color: string }
  | { id: string; page: number; xr: number; yr: number; type: "check"; sizeR: number; color: string }
  | { id: string; page: number; xr: number; yr: number; type: "sig"; src: string; wr: number; hr: number };

function hexRgb(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard Helvetica only encodes WinAnsi (Latin-1). Map the common smart punctuation a normal sheet
 *  picks up to ASCII, and replace anything still outside the range so drawText can't throw mid-save. */
function winAnsiSafe(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

/**
 * Burn the annotations into a copy of the source PDF and return the new bytes. Purely additive — it
 * only DRAWS text / vector checkmarks / signature images on top of each page; it never rewrites the
 * document's existing content streams, so the original text and layout are preserved exactly.
 */
export async function bakePdf(src: Uint8Array, annos: PdfAnno[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(src);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  // Embed each distinct signature image once, reused across placements.
  const sigCache = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const a of annos) {
    if (a.type === "sig" && !sigCache.has(a.src)) {
      sigCache.set(a.src, await doc.embedPng(dataUrlToBytes(a.src)));
    }
  }

  for (const a of annos) {
    const page = pages[a.page];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();

    if (a.type === "text") {
      const size = a.sizeR * ph;
      const color = hexRgb(a.color);
      const topY = ph - a.yr * ph; // top edge of the text box, measured up from the page bottom
      winAnsiSafe(a.text).split("\n").forEach((line, i) => {
        // PDF text y is the baseline; drop ~0.8em for the cap height, then a line per row.
        page.drawText(line, { x: a.xr * pw, y: topY - size * 0.8 - i * size * 1.2, size, font, color });
      });
    } else if (a.type === "check") {
      const s = a.sizeR * ph;
      const color = hexRgb(a.color);
      const ox = a.xr * pw, oyTop = a.yr * ph; // checkbox top-left (oyTop measured down from page top)
      const pt = (fx: number, fy: number) => ({ x: ox + fx * s, y: ph - (oyTop + fy * s) });
      const thickness = Math.max(1, s * 0.11);
      page.drawLine({ start: pt(0.16, 0.54), end: pt(0.42, 0.8), thickness, color });
      page.drawLine({ start: pt(0.42, 0.8), end: pt(0.84, 0.18), thickness, color });
    } else {
      const img = sigCache.get(a.src);
      if (!img) continue;
      const w = a.wr * pw, h = a.hr * ph;
      page.drawImage(img, { x: a.xr * pw, y: ph - a.yr * ph - h, width: w, height: h });
    }
  }

  return doc.save();
}
