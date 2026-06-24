// pdfjs-dist's default entry (`build/pdf.mjs`) calls bleeding-edge Map/WeakMap.prototype.
// getOrInsertComputed with no polyfill (its package engines target only node >=22.13/24), so
// page.render throws "getOrInsertComputed is not a function" in browsers that lack it → blank pages.
// We import the polyfilled `legacy/build` at runtime instead. It ships no own .d.ts, so map the
// subpath onto the package's published types — the legacy build exposes the same public API.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
