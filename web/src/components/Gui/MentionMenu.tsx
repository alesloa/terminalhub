import { useEffect } from "react";

/** One row of the @file / /command menu. */
export interface MentionItem {
  value: string;
  /** Shown after the value, dimmed — a command's description, a file's directory. */
  hint?: string;
}

/**
 * The list that opens above the composer while an `@` or `/` mention is being typed. Arrow keys and
 * Enter are handled by the composer's own keydown (the textarea keeps focus throughout), so this is
 * presentation plus the scroll-into-view that keyboard navigation needs to stay usable.
 */
export function MentionMenu({
  items, active, onPick,
}: {
  items: MentionItem[];
  active: number;
  onPick: (value: string) => void;
}) {
  useEffect(() => {
    document.getElementById(`tr-mention-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!items.length) return null;

  return (
    <div className="mb-1.5 max-h-52 overflow-y-auto rounded-lg border border-edge bg-elevated py-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={item.value}
          id={`tr-mention-${i}`}
          type="button"
          // Mouse-down rather than click: click fires after the textarea has already lost focus, and
          // blurring closes the menu, so the pick would land on a menu that no longer exists.
          onMouseDown={(e) => { e.preventDefault(); onPick(item.value); }}
          className={`flex w-full items-baseline gap-2 px-2.5 py-1 text-left text-xs transition-colors ${
            i === active ? "bg-accent/20 text-bright" : "text-muted hover:bg-elevated"
          }`}
        >
          <span className="shrink-0 truncate font-mono">{item.value}</span>
          {item.hint && <span className="min-w-0 flex-1 truncate text-[11px] text-dim">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}
