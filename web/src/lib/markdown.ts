import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

// CommonMark renderer for the read-only Markdown view. `html: false` is the whole point: raw
// angle-bracket text — `plugins/<name>/`, `List<T>`, `a < b`, `<your-token>` — is escaped to literal
// text instead of being parsed as an HTML/JSX tag. markdown-it never throws on any input, so unlike
// the MDX/Lexical editor (which aborts the entire document on a stray unclosed tag) the reader can
// render anything. `linkify` turns bare URLs into links; `breaks` matches a notes app's
// single-newline = line break reading view.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

// Open links in a new tab and harden `rel` — these notes are full of external URLs and a click must
// never navigate the whole app away. A DOMPurify hook (not a markdown-it rule) so it can't be
// bypassed by crafted markup and `noopener` is always present, even on links from raw HTML.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
});

/** Render Markdown source to sanitized HTML for the read-only view. Never throws. */
export function renderMarkdown(source: string): string {
  let raw: string;
  try {
    raw = md.render(source ?? "");
  } catch {
    // markdown-it is not supposed to throw, but the reader must never crash: fall back to the raw
    // source as escaped, preformatted text so the note is at least readable.
    raw = `<pre>${escapeHtml(source ?? "")}</pre>`;
  }
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
