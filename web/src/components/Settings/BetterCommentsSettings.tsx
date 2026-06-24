import type { CSSProperties, ReactNode } from "react";
import type { BetterCommentsConfig, CommentTag } from "../../api/types";
import { DEFAULT_BETTER_COMMENTS } from "../../lib/betterComments";

const NEW_TAG: CommentTag = { tag: "", color: "#cccccc", bold: false, italic: false, underline: false, strikethrough: false, backgroundColor: "transparent" };

/** Live preview of a tag's styling, as a React style object. */
function previewStyle(t: CommentTag): CSSProperties {
  const td = [t.underline && "underline", t.strikethrough && "line-through"].filter(Boolean).join(" ");
  return {
    color: t.color,
    backgroundColor: t.backgroundColor !== "transparent" ? t.backgroundColor : undefined,
    fontWeight: t.bold ? "bold" : undefined,
    fontStyle: t.italic ? "italic" : undefined,
    textDecoration: td || undefined,
  };
}

/** The Settings-modal section for editing Better Comments tags. Pure controlled component:
 * it owns no state, just renders `value` and emits the next config through `onChange`. */
export function BetterCommentsSettings({ value, onChange }: { value: BetterCommentsConfig; onChange: (next: BetterCommentsConfig) => void }) {
  const setTag = (i: number, patch: Partial<CommentTag>) =>
    onChange({ ...value, tags: value.tags.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const removeTag = (i: number) => onChange({ ...value, tags: value.tags.filter((_, idx) => idx !== i) });
  const addTag = () => onChange({ ...value, tags: [...value.tags, { ...NEW_TAG }] });
  const reset = () => onChange(structuredClone(DEFAULT_BETTER_COMMENTS));

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wide text-dim">Better Comments</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          <span>Enabled</span>
          <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} className="h-4 w-4 accent-blue-500" />
        </label>
      </div>
      <p className="text-xs text-dim">
        Color a comment’s text when it starts with one of these tags — in the editor and in diffs,
        across languages (e.g. <code>// ! alert</code>, <code># todo: thing</code>).
      </p>

      <div className={`space-y-1.5 ${value.enabled ? "" : "pointer-events-none opacity-40"}`}>
        {value.tags.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="color" value={t.color} title="Text color"
              onChange={(e) => setTag(i, { color: e.target.value })}
              className="h-7 w-7 shrink-0 cursor-pointer rounded border border-edge-strong bg-transparent"
            />
            <input
              value={t.tag} placeholder="tag" title="Marker the comment must start with"
              onChange={(e) => setTag(i, { tag: e.target.value })}
              className="w-20 shrink-0 rounded border border-edge-strong bg-canvas px-2 py-1 font-mono text-bright outline-none focus:border-blue-500"
            />
            <StyleBtn active={t.bold} onClick={() => setTag(i, { bold: !t.bold })} title="Bold"><b>B</b></StyleBtn>
            <StyleBtn active={t.italic} onClick={() => setTag(i, { italic: !t.italic })} title="Italic"><i>I</i></StyleBtn>
            <StyleBtn active={t.underline} onClick={() => setTag(i, { underline: !t.underline })} title="Underline"><span className="underline">U</span></StyleBtn>
            <StyleBtn active={t.strikethrough} onClick={() => setTag(i, { strikethrough: !t.strikethrough })} title="Strikethrough"><span className="line-through">S</span></StyleBtn>
            <StyleBtn
              active={t.backgroundColor !== "transparent"} title="Background highlight"
              onClick={() => setTag(i, { backgroundColor: t.backgroundColor !== "transparent" ? "transparent" : "rgb(var(--tr-selection))" })}
            >BG</StyleBtn>
            {t.backgroundColor !== "transparent" && (
              <input
                type="color" value={t.backgroundColor} title="Background color"
                onChange={(e) => setTag(i, { backgroundColor: e.target.value })}
                className="h-7 w-7 shrink-0 cursor-pointer rounded border border-edge-strong bg-transparent"
              />
            )}
            <span className="ml-1 flex-1 truncate rounded px-1 text-xs" style={previewStyle(t)}>
              {t.tag ? `${t.tag} preview` : "preview"}
            </span>
            <button
              type="button" onClick={() => removeTag(i)} title="Remove tag"
              className="h-7 w-7 shrink-0 rounded text-lg leading-none text-dim hover:bg-elevated hover:text-red-300"
            >×</button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={addTag} className="rounded bg-surface px-2.5 py-1 text-xs text-fg hover:bg-elevated">+ Add tag</button>
          <button type="button" onClick={reset} className="rounded px-2.5 py-1 text-xs text-dim hover:text-fg">Reset to defaults</button>
        </div>
      </div>
    </section>
  );
}

function StyleBtn({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} title={title}
      className={`h-7 w-7 shrink-0 rounded border border-edge-strong text-xs ${active ? "bg-edge-strong text-bright" : "bg-canvas text-dim hover:text-fg"}`}
    >{children}</button>
  );
}
