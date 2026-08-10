import { memo, useMemo, useState } from "react";
import type { GuiBlock } from "../../api/guiTypes";
import { renderMarkdown } from "../../lib/markdown";

// theme.css defines `.tr-markdown` AFTER `@tailwind utilities`, so a Tailwind arbitrary variant of
// equal specificity loses the tie. The `!` prefix is the cheapest way to pull the document-scale
// heading/spacing rhythm down to chat scale without forking the whole markdown theme.
const MD_CLASS =
  "tr-markdown text-sm leading-6 [&>*+*]:!mt-3 " +
  "[&_h1]:!text-[1.05rem] [&_h1]:!mt-4 [&_h1]:!pb-1 " +
  "[&_h2]:!text-[1rem] [&_h2]:!mt-4 [&_h2]:!pb-0 [&_h2]:!border-0 " +
  "[&_h3]:!text-[0.95rem] [&_h3]:!mt-3 [&_h4]:!text-sm [&_h4]:!mt-3 " +
  "[&_pre]:!p-2.5 [&_pre]:!text-[11px] [&_pre]:!leading-5 [&_hr]:!my-3";

/**
 * A stretch of assistant text/thinking. Tool calls are rendered by ToolRun instead — they're grouped
 * across message boundaries, so they can't be drawn per-message (see transcriptRows.ts).
 */
export const BlockGroup = memo(function BlockGroup({ blocks }: { blocks: GuiBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((b) => <BlockView key={b.id} block={b} />)}
    </div>
  );
});

function BlockView({ block }: { block: GuiBlock }) {
  if (block.kind === "thinking") return <ThinkingBlock text={block.text} />;
  if (block.kind === "text") return <TextBlock text={block.text} />;
  if (block.kind === "image") return <ImageBlock mediaType={block.mediaType} dataBase64={block.dataBase64} />;
  return null; // tool blocks never reach here
}

/** An image the user attached. Rendered from the same base64 that was sent to the model — there is
 *  no file on disk behind it, so a data URI is the only thing to point at. */
export const ImageBlock = memo(function ImageBlock({ mediaType, dataBase64 }: { mediaType: string; dataBase64: string }) {
  return (
    <img
      src={`data:${mediaType};base64,${dataBase64}`}
      alt="attachment"
      className="max-h-64 w-auto max-w-full rounded-lg border border-edge object-contain"
    />
  );
});

// Memoized + useMemo'd so the markdown pipeline runs once per changed text, not once per rendered
// frame of the whole transcript.
const TextBlock = memo(function TextBlock({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  if (!text.trim()) return null;
  return <div className={MD_CLASS} dangerouslySetInnerHTML={{ __html: html }} />;
});

const ThinkingBlock = memo(function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="rounded-lg border border-edge bg-panel/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-dim transition-colors hover:bg-elevated/60"
      >
        <span className="italic">Thinking</span>
        {!open && <span className="min-w-0 flex-1 truncate opacity-80">{text.replace(/\s+/g, " ").trim()}</span>}
        <span className={`ml-auto shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap break-words border-t border-edge px-2.5 py-2 text-[12px] italic leading-5 text-muted">
          {text}
        </div>
      )}
    </div>
  );
});
