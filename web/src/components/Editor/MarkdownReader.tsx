import { useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";

/**
 * Read-only Markdown view: source → sanitized static HTML, with no editor framework mounted. This is
 * the DEFAULT way a `.md` opens. Because it renders plain HTML (markdown-it, `html: false`) it cannot
 * throw on real-world notes the way the MDX/Lexical editor does — a stray `<name>`, `List<T>`, or
 * `a < b` shows as literal text instead of crashing the whole document. CPU also stays flat on big
 * files since there is no live editor running while reading.
 *
 * Shares `.tr-mdx-content` so theme vars, the brightness tint, and link colors apply exactly as they
 * do in edit mode; `.tr-md-reader` adds the block typography (heading scale, spacing, lists) the
 * Lexical editor theme used to provide.
 */
export function MarkdownReader({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return (
    <div
      className="tr-mdx-content tr-md-reader"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
