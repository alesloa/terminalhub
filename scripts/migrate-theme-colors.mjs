// One-shot migration: rewrite hardcoded chrome hex colors in web/src to theme-token classes.
//  - Tailwind arbitrary values  [#11141c]      -> panel        (bg-[#11141c] -> bg-panel)
//  - inline styles / raw CSS     "#0b0e14"      -> "rgb(var(--tr-bg))"
// Only the high-confidence chrome palette below is touched. Unmapped hexes (status pills, the
// Windows-logo squares, Better Comments defaults, brand badges) are left literal on purpose.
// Run: node scripts/migrate-theme-colors.mjs [--write]
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WRITE = process.argv.includes("--write");
const ROOT = new URL("../web/src", import.meta.url).pathname;

// token -> [tailwind class fragment, css var]
const TOKEN = {
  bg: ["canvas", "--tr-bg"], panel: ["panel", "--tr-panel"], surface: ["surface", "--tr-surface"],
  elevated: ["elevated", "--tr-elevated"], code: ["code", "--tr-code"],
  edge: ["edge", "--tr-edge"], edgeStrong: ["edge-strong", "--tr-edge-strong"],
  text: ["fg", "--tr-text"], textBright: ["bright", "--tr-text-bright"],
  textMuted: ["muted", "--tr-text-muted"], textDim: ["dim", "--tr-text-dim"],
  accent: ["accent", "--tr-accent"], link: ["link", "--tr-link"], selection: ["selection", "--tr-selection"],
  success: ["success", "--tr-success"], error: ["error", "--tr-error"],
};

// hex -> token  (lowercase keys)
const HEX = {
  "#0b0e14": "bg", "#0e1119": "bg", "#0f1219": "bg", "#0f121a": "bg", "#10141d": "bg",
  "#14161c": "bg", "#0d1320": "bg", "#04050a": "bg", "#07090f": "bg",
  "#090c12": "code", "#0c1018": "code", "#0d1018": "code",
  "#11141c": "panel", "#141925": "panel",
  "#151a26": "surface", "#161b26": "surface", "#161b27": "surface",
  "#1b2030": "elevated", "#1d2331": "elevated",
  "#222838": "edge", "#222a3d": "edge", "#252b3b": "edge",
  "#2c3346": "edgeStrong", "#26334a": "edgeStrong", "#2a3040": "edgeStrong", "#2a3246": "edgeStrong",
  "#3b4255": "edgeStrong", "#3b4664": "edgeStrong", "#474747": "edgeStrong",
  "#cdd6f4": "text", "#cbd5e1": "text", "#d1d5db": "text", "#d1d7e6": "text", "#e5e7eb": "text",
  "#f3f4f6": "textBright",
  "#94a3b8": "textMuted", "#a1a1aa": "textMuted",
  "#64748b": "textDim",
  "#3b82f6": "accent", "#157efb": "accent", "#3794ff": "accent", "#3498db": "accent",
  "#60a5fa": "link", "#93c5fd": "link", "#bfdbfe": "link",
  "#264f78": "selection",
  "#22c55e": "success", "#73c991": "success", "#98c379": "success",
  "#f43f5e": "error",
};

// Files/dirs to skip: the theme module DEFINES these hexes; betterComments + terminal hook need literals.
const SKIP = (p) => p.includes("/theme/") || p.endsWith("/lib/betterComments.ts") || p.endsWith("/hooks/useTerminalSocket.ts");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

let totalBracket = 0, totalInline = 0, touched = 0;
for (const file of walk(ROOT)) {
  if (SKIP(file)) continue;
  const orig = readFileSync(file, "utf8");
  let s = orig;
  // Pass 1: Tailwind arbitrary values [#hex] -> token class fragment
  s = s.replace(/\[#([0-9a-fA-F]{6})\]/g, (m, h) => {
    const tok = HEX["#" + h.toLowerCase()];
    if (!tok) return m;
    totalBracket++;
    return TOKEN[tok][0];
  });
  // Pass 2: remaining bare/quoted hex -> rgb(var(--tr-x))
  s = s.replace(/#([0-9a-fA-F]{6})\b/g, (m, h) => {
    const tok = HEX["#" + h.toLowerCase()];
    if (!tok) return m;
    totalInline++;
    return `rgb(var(${TOKEN[tok][1]}))`;
  });
  if (s !== orig) {
    touched++;
    if (WRITE) writeFileSync(file, s);
  }
}
console.log(`${WRITE ? "WROTE" : "DRY-RUN"}: ${touched} files, ${totalBracket} tailwind tokens, ${totalInline} inline vars`);
