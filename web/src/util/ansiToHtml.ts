// Minimal SGR(ANSI) -> HTML for read-only terminal previews (the Stage Manager thumbnails).
// Handles reset/bold and the 16 fg/bg colors — the common case for `capture-pane -e`. Unknown
// codes (256-color, truecolor, italics, etc.) are ignored rather than mis-rendered. Input is the
// raw tmux capture; output is HTML safe to inject into a <pre> (all text is escaped first; only
// <span style> for known codes is emitted).

const FG: Record<number, string> = {
  30: "#1e1e1e", 31: "#f87171", 32: "#4ade80", 33: "#fbbf24", 34: "#60a5fa",
  35: "#c084fc", 36: "#22d3ee", 37: "#cccccc",
  90: "#717171", 91: "#fca5a5", 92: "#86efac", 93: "#fde68a", 94: "#93c5fd",
  95: "#d8b4fe", 96: "#67e8f9", 97: "#ffffff",
};
const BG: Record<number, string> = {
  40: "#1e1e1e", 41: "#7f1d1d", 42: "#14532d", 43: "#78350f", 44: "#1e3a8a",
  45: "#581c87", 46: "#155e75", 47: "#3f3f46",
  100: "#3f3f46", 101: "#991b1b", 102: "#166534", 103: "#92400e", 104: "#1e40af",
  105: "#6b21a8", 106: "#0e7490", 107: "#52525b",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function ansiToHtml(input: string): string {
  // Split on SGR sequences; capture groups land the numeric params at odd indices.
  // eslint-disable-next-line no-control-regex
  const parts = input.split(/\x1b\[([0-9;]*)m/);
  let fg = ""; let bg = ""; let bold = false;
  let open = false;
  let out = "";
  const closeSpan = () => { if (open) { out += "</span>"; open = false; } };
  const openSpan = () => {
    const styles: string[] = [];
    if (fg) styles.push(`color:${fg}`);
    if (bg) styles.push(`background:${bg}`);
    if (bold) styles.push("font-weight:600");
    if (!styles.length) return;
    out += `<span style="${styles.join(";")}">`; open = true;
  };
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { out += escapeHtml(parts[i]); continue; }
    const codes = parts[i] === "" ? [0] : parts[i].split(";").map(Number);
    closeSpan();
    for (const c of codes) {
      if (c === 0) { fg = ""; bg = ""; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = "";
      else if (c === 49) bg = "";
      else if (FG[c]) fg = FG[c];
      else if (BG[c]) bg = BG[c];
    }
    openSpan();
  }
  closeSpan();
  return out;
}
