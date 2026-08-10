import { memo, useState } from "react";
import { ToolCard, type GuiToolBlock } from "./ToolCard";
import { splitToolRun } from "./transcriptRows";

/**
 * A run of back-to-back tool calls. Collapsed, it shows the newest call and folds the rest behind a
 * "+N previous tool calls" toggle above them — above, not below, because this transcript reads
 * top-down and the hidden calls happened first.
 */
export const ToolRun = memo(function ToolRun({ blocks }: { blocks: GuiToolBlock[] }) {
  const [open, setOpen] = useState(false);
  const { hidden, shown } = splitToolRun(blocks);
  // The run grows as the turn goes; once you've opened it, it stays open.
  const rendered = open ? blocks : shown;

  return (
    <div className="space-y-2">
      {hidden.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-left text-xs text-dim transition-colors hover:bg-elevated/60 hover:text-muted"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span>
            {open ? "Hide" : "+"}{open ? " " : ""}{hidden.length} previous tool call{hidden.length === 1 ? "" : "s"}
          </span>
        </button>
      )}
      {rendered.map((b) => <ToolCard key={b.id} block={b} />)}
    </div>
  );
});
