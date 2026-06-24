// Map a BCP-47 tag (es-ES, en-US) to a human language name ("Spanish", "English"). Built into the
// platform — no dependency. The base language (the part before the "-") is the key users think in,
// so we group and filter on it while still showing the full locale where it matters. Shared by the
// voice curator and the voice picker so they label languages identically.
let displayNames: Intl.DisplayNames | null = null;
try {
  displayNames = new Intl.DisplayNames([typeof navigator !== "undefined" ? navigator.language : "en"], { type: "language" });
} catch { /* older browser: fall back to the raw code */ }

export const baseLang = (code: string): string => (code || "—").split("-")[0].toLowerCase();

export function langLabel(code: string): string {
  const base = baseLang(code);
  if (!base || base === "—") return code || "—";
  try { return displayNames?.of(base) ?? base.toUpperCase(); } catch { return base.toUpperCase(); }
}
