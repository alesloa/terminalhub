import { memo, useMemo } from "react";

// Leaf module of the GUI chat tree. The `unknown`-input guards live HERE rather than next to their
// heaviest consumer (ToolCard) because ToolCard imports this file — putting them the other way round
// would make the two modules circular.

/** Narrow an unknown tool input to a plain object, or null when it isn't one. */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A non-empty string field, or null. */
export function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export interface DiffInput {
  oldText: string;
  newText: string;
}

/**
 * The two sides of a diff for a file-editing tool input, or null when the tool doesn't edit a file.
 * Keyed on the SHAPE (`old_string`/`new_string`) rather than the tool name so an Edit-shaped call
 * still renders when the agent uses a differently-named editing tool; `Write` is name-gated because
 * `content` is a common field elsewhere.
 */
export function diffInputOf(name: string, input: unknown): DiffInput | null {
  const rec = asRecord(input);
  if (!rec) return null;
  if ("old_string" in rec || "new_string" in rec) {
    return {
      oldText: typeof rec.old_string === "string" ? rec.old_string : "",
      newText: typeof rec.new_string === "string" ? rec.new_string : "",
    };
  }
  if (name === "Write" && typeof rec.content === "string") return { oldText: "", newText: rec.content };
  return null;
}

const MAX_ROWS = 60; // beyond this the card stops being a glance-able summary — link out to the editor instead

interface Hunk {
  leadingContext: number;
  removed: string[];
  added: string[];
  trailingContext: number;
}

/**
 * Line-level diff, deliberately not a real LCS: trim the shared head and tail, then everything left
 * in `old` is removed and everything left in `new` is added. For the single contiguous replacement
 * an Edit call actually is, that produces exactly the right answer at a fraction of the code.
 */
function lineDiff(oldText: string, newText: string): Hunk {
  const a = oldText === "" ? [] : oldText.split("\n");
  const b = newText === "" ? [] : newText.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) tail++;
  return {
    leadingContext: head,
    removed: a.slice(head, a.length - tail),
    added: b.slice(head, b.length - tail),
    trailingContext: tail,
  };
}

/** Compact added/removed view for an Edit- or Write-shaped tool input. */
export const DiffBlock = memo(function DiffBlock({ oldText, newText }: DiffInput) {
  const hunk = useMemo(() => lineDiff(oldText, newText), [oldText, newText]);

  const total = hunk.removed.length + hunk.added.length;
  if (total === 0) {
    return <div className="rounded-md border border-edge bg-code px-2.5 py-1.5 text-[11px] text-dim">No change.</div>;
  }

  // Split the row budget across both sides so a huge rewrite still shows some of each.
  const budget = Math.max(1, Math.floor(MAX_ROWS / 2));
  const removed = hunk.removed.length > MAX_ROWS ? hunk.removed.slice(0, budget) : hunk.removed;
  const added = hunk.added.length > MAX_ROWS ? hunk.added.slice(0, budget) : hunk.added;
  const hidden = total - removed.length - added.length;

  return (
    <div className="overflow-hidden rounded-md border border-edge bg-code font-mono text-[11px] leading-5">
      {hunk.leadingContext > 0 && <Context n={hunk.leadingContext} />}
      {removed.map((line, i) => <Row key={`r${i}`} sign="-" line={line} kind="removed" />)}
      {added.map((line, i) => <Row key={`a${i}`} sign="+" line={line} kind="added" />)}
      {hidden > 0 && (
        <div className="border-t border-edge px-2.5 py-1 text-dim">…{hidden} more changed line{hidden === 1 ? "" : "s"}</div>
      )}
      {hunk.trailingContext > 0 && <Context n={hunk.trailingContext} />}
    </div>
  );
});

function Context({ n }: { n: number }) {
  return <div className="bg-panel/60 px-2.5 py-0.5 text-dim">⋯ {n} unchanged line{n === 1 ? "" : "s"}</div>;
}

function Row({ sign, line, kind }: { sign: "+" | "-"; line: string; kind: "added" | "removed" }) {
  const tone = kind === "added" ? "bg-success/10 text-success" : "bg-error/10 text-error";
  return (
    <div className={`flex ${tone}`}>
      <span className="w-4 shrink-0 select-none pl-1.5 opacity-70">{sign}</span>
      {/* break-all: source lines have no spaces to wrap on, and a horizontal scrollbar inside an
          already-scrolling transcript is miserable to use. */}
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">{line || " "}</span>
    </div>
  );
}
