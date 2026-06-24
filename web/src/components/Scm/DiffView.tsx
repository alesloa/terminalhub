import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorView, lineNumbers as lineNumberGutter } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { MergeView, unifiedMergeView, getChunks } from "@codemirror/merge";
import { api } from "../../api/client";
import { useUi } from "../../store/ui";
import { isImageFile, imageMime } from "../../lib/fileKinds";
import { diffTheme, fillHeight, loadLanguage } from "../../lib/codeMirror";
import { vscodeDark } from "../../lib/vscodeDark";
import { betterCommentsExtension } from "../../lib/betterComments";
import { EditorToggles, ToggleBtn } from "../Editor/EditorToggles";

// Where one side of a diff comes from: a working-copy file, a git object at a rev, or nothing (the
// empty side of an add/delete). Images and binary fallbacks read bytes from these.
type Side = { kind: "worktree"; path: string } | { kind: "git"; rev: string; file: string } | null;

/** Both sides of one file's diff. For images, oldText/newText stay empty and the sides drive an
 *  image render; for everything else they hold the (possibly bytes-derived) text the merge view shows. */
interface FileSides { name: string; image: boolean; old: Side; new: Side; oldText: string; newText: string }

/** Map a diff request to the (old, new) source of every file it covers — no IO, just where to read. */
async function fileDescriptors(
  root: string,
  d: { file?: string; staged?: boolean; untracked?: boolean; commit?: string; stash?: string },
): Promise<{ name: string; old: Side; new: Side }[]> {
  const wt = (file: string): Side => ({ kind: "worktree", path: `${root}/${file}` });
  const git = (rev: string, file: string): Side => ({ kind: "git", rev, file });
  if (d.commit && d.file) return [{ name: d.file, old: git(`${d.commit}^`, d.file), new: git(d.commit, d.file) }];
  if (d.commit) {
    const { files } = await api.git.commitFiles(root, d.commit);
    return files.map(f => ({ name: f.path, old: git(`${d.commit}^`, f.path), new: git(d.commit!, f.path) }));
  }
  if (d.stash) {
    const { files } = await api.git.stashFiles(root, d.stash);
    return files.map(f => ({ name: f.path, old: git(`${d.stash}^1`, f.path), new: git(d.stash!, f.path) }));
  }
  const file = d.file!;
  if (d.untracked) return [{ name: file, old: null, new: wt(file) }];        // brand-new file: all additions
  if (d.staged) return [{ name: file, old: git("HEAD", file), new: git("", file) }]; // HEAD → index
  return [{ name: file, old: git("", file), new: wt(file) }];                // index → working copy
}

async function readSideText(root: string, side: Side): Promise<{ text: string; binary: boolean }> {
  if (!side) return { text: "", binary: false };
  if (side.kind === "worktree") { const f = await api.fsReadFile(side.path).catch(() => null); return { text: f?.content ?? "", binary: !!f?.binary }; }
  const r = await api.git.showFile(root, side.rev, side.file).catch(() => ({ content: "" })); return { text: r.content, binary: false };
}

async function readSideBytesText(root: string, side: Side): Promise<string> {
  if (!side) return "";
  if (side.kind === "worktree") { const f = await api.fsReadFileBytes(side.path).catch(() => null); return f?.dataBase64 && !f.tooLarge ? bytesToText(f.dataBase64) : ""; }
  const r = await api.git.showFileBytes(root, side.rev, side.file).catch(() => null); return r?.dataBase64 ? bytesToText(r.dataBase64) : "";
}

/** Raw bytes as text so a binary file is still VIEWABLE in the diff (each byte → one char). Lossy on a
 *  round-trip, which is why the diff is read-only — actually editing a binary happens in the editor. */
function bytesToText(b64: string): string { try { return atob(b64); } catch { return ""; } }
const looksBinaryText = (s: string) => s.includes(String.fromCharCode(0)) || s.includes(String.fromCharCode(0xFFFD)); // NUL / U+FFFD → not displayable text

/**
 * Assemble old/new content for everything this diff covers (a working-tree file, a whole commit, or a
 * stash). Images render from their bytes; other files show a text diff, falling back to raw
 * bytes-as-text for binaries so nothing dead-ends on "no textual changes".
 */
async function fetchSides(
  root: string,
  d: { file?: string; staged?: boolean; untracked?: boolean; commit?: string; stash?: string },
): Promise<FileSides[]> {
  const descs = await fileDescriptors(root, d);
  return Promise.all(descs.map(async ({ name, old, new: nw }) => {
    if (isImageFile(name)) return { name, image: true, old, new: nw, oldText: "", newText: "" };
    const [o, n] = await Promise.all([readSideText(root, old), readSideText(root, nw)]);
    let oldText = o.text, newText = n.text;
    if (o.binary || n.binary || looksBinaryText(oldText) || looksBinaryText(newText) || (!oldText && !newText)) {
      const [ob, nb] = await Promise.all([readSideBytesText(root, old), readSideBytesText(root, nw)]);
      if (ob || nb) { oldText = ob; newText = nb; }
    }
    return { name, image: false, old, new: nw, oldText, newText };
  }));
}

export function DiffView({ root, file, staged, untracked, commit, stash }:
  { root: string; file?: string; staged?: boolean; untracked?: boolean; commit?: string; stash?: string }) {
  const split = useUi(s => s.diffSplit);
  // A commit's or stash's diff is immutable (no polling); a working-tree diff re-reads on an interval.
  const frozen = commit || stash;
  const { data, isLoading, error } = useQuery({
    // Include `file` even in the frozen key so a single-file commit diff and the whole-commit
    // diff for the same hash don't collide on the same cache entry.
    queryKey: frozen ? ["git", "sides", root, frozen, file ?? null] : ["git", "sides", root, file, staged ?? false, untracked ?? false],
    queryFn: () => fetchSides(root, { file, staged, untracked, commit, stash }),
    refetchInterval: frozen ? false : 4000,
  });

  if (isLoading) return <Msg>loading diff…</Msg>;
  if (error) return <Msg className="text-red-400">{(error as Error).message}</Msg>;
  // Keep every image (always render it) plus any non-image file whose text actually differs.
  const files = (data ?? []).filter(f => f.image || f.oldText !== f.newText);
  if (!files.length) return <Msg>No changes.</Msg>;

  const label = commit && file ? `${file}  ·  ${commit.slice(0, 8)}`
    : commit ? `commit ${commit.slice(0, 8)}`
    : stash ? `stash ${stash}`
    : `${file}${staged ? "  ·  staged" : untracked ? "  ·  untracked" : ""}`;

  // A single-file diff fills the pane and lets the editor own its scroll, so the minimap pins
  // and its thumb works (VS Code's diff). Multi-file diffs (a whole commit/stash) stay stacked
  // with the outer pane scrolling, where a per-editor minimap can't pin — so it's off there.
  const fill = files.length === 1;

  return (
    <div className="absolute inset-0 flex flex-col bg-canvas">
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-b border-edge text-xs text-muted">
        <span className="font-mono truncate">{label}</span>
        <div className="ml-auto"><DiffToolbar /></div>
      </div>
      <div className={`flex-1 min-h-0 ${fill ? "overflow-hidden" : "overflow-auto"}`}>
        {files.map(f => (
          <div key={f.name} className={fill ? "h-full min-h-0" : ""}>
            {(commit || stash) && files.length > 1 && (
              <div className="px-3 py-1 font-mono text-[11px] text-muted bg-panel border-y border-edge sticky top-0 z-[1]">
                {f.name}
              </div>
            )}
            {f.image
              ? <ImageDiff root={root} name={f.name} oldSide={f.old} newSide={f.new} fill={fill} />
              : <MergeFile oldText={f.oldText} newText={f.newText} name={f.name} fill={fill} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// Light checkerboard so transparent PNGs/SVGs read as transparent against the pane (mirrors ImageView).
const CHECKER: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #80808022 25%, transparent 25%), linear-gradient(-45deg, #80808022 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #80808022 75%), linear-gradient(-45deg, transparent 75%, #80808022 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

const sideKey = (s: Side) => (s ? (s.kind === "worktree" ? `wt:${s.path}` : `git:${s.rev}:${s.file}`) : "none");

async function fetchSideBytes(root: string, side: Side): Promise<{ dataBase64: string | null; size: number }> {
  if (!side) return { dataBase64: null, size: 0 };
  if (side.kind === "worktree") { const f = await api.fsReadFileBytes(side.path); return { dataBase64: f.tooLarge ? null : (f.dataBase64 ?? null), size: f.size }; }
  return api.git.showFileBytes(root, side.rev, side.file);
}

/** One side of an image diff: fetch its bytes (working copy or git object) and build a data URL. */
function useImageSide(root: string, side: Side, name: string) {
  const q = useQuery({
    queryKey: ["git", "image-side", root, sideKey(side)],
    queryFn: () => fetchSideBytes(root, side),
    enabled: !!side,
    staleTime: 10_000,
  });
  const data = side ? q.data : null;
  return {
    loading: !!side && q.isLoading,
    src: data?.dataBase64 ? `data:${imageMime(name)};base64,${data.dataBase64}` : null,
    size: data?.size ?? 0,
  };
}

/** Image files render as images, not text. Shows before|after when both sides exist (a modified
 *  image), or a single pane for an added/deleted one — so an image change is never a dead-end. */
function ImageDiff({ root, name, oldSide, newSide, fill }:
  { root: string; name: string; oldSide: Side; newSide: Side; fill: boolean }) {
  const before = useImageSide(root, oldSide, name);
  const after = useImageSide(root, newSide, name);

  if (before.loading || after.loading) return <Msg>loading image…</Msg>;
  if (!before.src && !after.src) return <Msg>Couldn’t read this image.</Msg>;
  const both = !!before.src && !!after.src;

  return (
    <div className={`flex ${fill ? "h-full min-h-0" : "min-h-[12rem]"}`}>
      {before.src && <ImagePane label={both ? "Before" : "Deleted"} src={before.src} size={before.size} name={name} />}
      {after.src && <ImagePane label={both ? "After" : "Added"} src={after.src} size={after.size} name={name} />}
    </div>
  );
}

function ImagePane({ label, src, size, name }: { label: string; src: string; size: number; name: string }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-edge last:border-r-0">
      <div className="shrink-0 flex items-center gap-2 h-7 px-3 text-[11px] text-dim border-b border-edge bg-panel">
        <span className="font-medium text-muted">{label}</span>
        {dims && <span>{dims.w} × {dims.h}</span>}
        <span>{fmtBytes(size)}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center" style={CHECKER}>
        <img src={src} alt={name} draggable={false}
          onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className="max-w-full max-h-full object-contain" />
      </div>
    </div>
  );
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
}

// @codemirror/merge defaults to `scanLimit: 500`, which is FAR too low for real source files: its
// Myers diff bails to a crude "the whole region is one big change" fallback once the scan budget is
// exceeded, so a large file with a normal change renders with nearly every line marked changed (a
// 2300-line file with a real 99/44-line edit collapsed to a single 74%-of-file change). Lifting the
// cap makes that exact file diff precisely (~233 small changes, the same VS Code shows) in <100ms.
// `timeout` is the wall-clock backstop so a pathological diff of two unrelated big files can't hang
// the main thread — it falls back to the crude diff after the budget instead of freezing. Passed to
// BOTH the split (MergeView) and unified (unifiedMergeView) paths.
const DIFF_CONFIG = { scanLimit: 50000, timeout: 2000 };

/** One file's diff as a CodeMirror merge view — split (side-by-side) or inline (unified).
 *  `fill` = this is the only file, so it fills the pane and owns its scroll (see DiffView). */
function MergeFile({ oldText, newText, name, fill }: { oldText: string; newText: string; name: string; fill: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const split = useUi(s => s.diffSplit);
  const minimap = useUi(s => s.minimap);
  const wordWrap = useUi(s => s.wordWrap);
  const showLineNumbers = useUi(s => s.lineNumbers);
  const betterComments = useUi(s => s.betterComments);
  // undefined = language not loaded yet; null/[] = loaded, no language match. Build only once loaded.
  const [lang, setLang] = useState<Extension | null | undefined>(undefined);

  // The diff doesn't use the code minimap — it uses a VS Code-style change-overview ruler (a thin
  // column of red/green marks at each change, for navigation). It needs the editor to own its scroll,
  // which only the single-file (`fill`) diff does; multi-file diffs scroll the outer pane, so no ruler.
  // Gated on the same `minimap` toggle the rest of the app uses.
  const wantRuler = minimap && fill;

  useEffect(() => {
    let on = true;
    loadLanguage(name).then(l => { if (on) setLang(l ?? []); });
    return () => { on = false; };
  }, [name]);

  useEffect(() => {
    if (lang === undefined || !host.current) return;
    const el = host.current;
    const common: Extension[] = [
      diffTheme, vscodeDark, lang ?? [],
      EditorState.readOnly.of(true), EditorView.editable.of(false),
      showLineNumbers ? lineNumberGutter() : [],
      wordWrap ? EditorView.lineWrapping : [],
      betterCommentsExtension(betterComments),
    ];

    let syncIndicator = () => {};
    let drawMarks = () => {};
    let mmView: EditorView | null = null; // editor the overview ruler attaches to (new side / unified)
    let cleanup = () => {};

    if (split) {
      const mv = new MergeView({
        a: { doc: oldText, extensions: common },
        b: { doc: newText, extensions: common },
        parent: el,
        gutter: true,
        highlightChanges: true,
        diffConfig: DIFF_CONFIG, // precise diff on big files (see DIFF_CONFIG). No collapseUnchanged:
                                 // every line is always shown/expanded (the maintainer wants the whole file).
      });
      cleanup = () => mv.destroy();
      if (fill) {
        // Single-file split: the `.cm-diff-fill` CSS gives each side its own scroll (so the ruler
        // pins); keep the two sides vertically in sync (drag the ruler → scrolls b → mirrors a).
        mv.dom.style.height = "100%";
        const a = mv.a.scrollDOM, b = mv.b.scrollDOM;
        // With the ruler present, the left pane scrolls in sync with the right; hide its native bar so
        // the only scroll control is the (thick) ruler on the far right, like VS Code's split diff.
        if (wantRuler) a.classList.add("no-scrollbar");
        let lock = false;
        const onA = () => { if (lock) return; lock = true; b.scrollTop = a.scrollTop; lock = false; };
        const onB = () => { if (lock) return; lock = true; a.scrollTop = b.scrollTop; lock = false; };
        a.addEventListener("scroll", onA); b.addEventListener("scroll", onB);
        mmView = mv.b;
        cleanup = () => { a.removeEventListener("scroll", onA); b.removeEventListener("scroll", onB); mv.destroy(); };
      }
    } else {
      const view = new EditorView({
        parent: el,
        state: EditorState.create({
          doc: newText,
          extensions: [...common,
            fill ? fillHeight : [], // unified single-file: editor owns its scroll (ruler pins)
            unifiedMergeView({ original: oldText, mergeControls: false, diffConfig: DIFF_CONFIG })], // no collapseUnchanged: always show every line
        }),
      });
      mmView = view;
      cleanup = () => view.destroy();
    }

    // VS Code-style diff OVERVIEW RULER (not a code minimap): a thin column on the editor's right edge
    // showing one colored mark per change chunk (green = added/changed, red = deleted) at its position
    // in the file, so changes are easy to spot and jump to. A translucent thumb shows the viewport;
    // click/drag anywhere on the ruler scrolls there. `mmView` always holds the new doc, so chunk
    // fromB/toB are its positions; a chunk empty on the new side (toB<=fromB) is a pure deletion.
    if (mmView && wantRuler) {
      const v = mmView;
      const ruler = document.createElement("div"); ruler.className = "tr-diff-ruler";
      const marks = document.createElement("div"); marks.className = "tr-diff-ruler-marks";
      const thumb = document.createElement("div"); thumb.className = "tr-mm-thumb";
      ruler.appendChild(marks); ruler.appendChild(thumb);
      v.dom.appendChild(ruler); // .cm-editor is the positioning context (see `.cm-diff-fill .cm-editor` CSS)
      const sd = v.scrollDOM;
      sd.classList.add("no-scrollbar"); // the ruler IS the scroll control — hide the native bar under it

      syncIndicator = () => {
        const rH = ruler.clientHeight, sh = sd.scrollHeight, ch = sd.clientHeight;
        const max = sh - ch, ratio = max > 0 ? sd.scrollTop / max : 0;
        const th = sh > 0 ? Math.min(rH, Math.max(24, (ch / sh) * rH)) : rH;
        thumb.style.height = th + "px";
        thumb.style.top = (ratio * Math.max(0, rH - th)) + "px";
      };
      drawMarks = () => {
        const total = v.contentHeight, rH = ruler.clientHeight;
        if (total <= 0 || rH <= 0) return;
        const got = getChunks(v.state);
        const lh = v.defaultLineHeight || 16, docLen = v.state.doc.length;
        marks.replaceChildren();
        const bar = (topPx: number, hPx: number, cls: string) => {
          const m = document.createElement("div");
          m.className = cls;
          m.style.top = ((topPx / total) * rH) + "px";
          m.style.height = Math.max(2, (hPx / total) * rH) + "px";
          marks.appendChild(m);
        };
        // Each chunk is removed lines (old) replaced by added lines (new). Like VS Code's diff overview
        // ruler, show BOTH at the chunk's vertical position in two lanes — red (removed) on the left,
        // green (added) on the right — so a modification reads as red+green per line, not a solid block.
        for (const c of got?.chunks ?? []) {
          const top = v.lineBlockAt(Math.min(c.fromB, docLen)).top;
          if (c.toB > c.fromB) { // added / changed lines exist in the new doc → measure them directly
            const bottom = v.lineBlockAt(Math.min(c.toB, docLen)).bottom;
            bar(top, bottom - top, "tr-diff-mark add");
          }
          if (c.toA > c.fromA) { // removed lines aren't in the new doc → size from the old text's line count
            const delLines = oldText.slice(c.fromA, c.toA).split("\n").length;
            bar(top, delLines * lh, "tr-diff-mark del");
          }
        }
      };

      sd.addEventListener("scroll", syncIndicator, { passive: true });
      const scrubTo = (clientY: number) => {
        const r = ruler.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
        sd.scrollTop = ratio * (sd.scrollHeight - sd.clientHeight);
      };
      const onMove = (ev: MouseEvent) => scrubTo(ev.clientY);
      const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      const onDown = (ev: MouseEvent) => { ev.preventDefault(); scrubTo(ev.clientY); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp); };
      ruler.addEventListener("mousedown", onDown);

      const prev = cleanup;
      cleanup = () => { sd.removeEventListener("scroll", syncIndicator); ruler.removeEventListener("mousedown", onDown); onUp(); ruler.remove(); prev(); };
    }

    // Redraw on layout settle, host resize, AND content-height changes — the last one catches
    // expanding/collapsing the "N unchanged lines" folds, which grow the content without resizing
    // the host. drawMarks/syncIndicator only read geometry + set the ruler's styles, so observing
    // the content can't loop. Cheap (a few marks), so just redraw on any observed change.
    const redraw = () => { drawMarks(); syncIndicator(); };
    const raf = requestAnimationFrame(redraw);
    const ro = new ResizeObserver(redraw);
    ro.observe(el);
    if (mmView) ro.observe(mmView.contentDOM);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); cleanup(); };
  }, [oldText, newText, name, lang, split, wantRuler, wordWrap, showLineNumbers, betterComments, fill]);

  return <div ref={host} className={`cm-diff-host ${fill ? "cm-diff-fill h-full min-h-0" : ""}`} />;
}

/** Segmented split↔unified control, plus the shared minimap / word-wrap toggles. */
function DiffToolbar() {
  const split = useUi(s => s.diffSplit);
  const setSplit = useUi(s => s.setDiffSplit);
  return (
    <div className="flex items-center gap-1">
      <div className="flex rounded border border-edge overflow-hidden">
        <ToggleBtn active={!split} onClick={() => setSplit(false)} title="Inline (unified) diff">Unified</ToggleBtn>
        <ToggleBtn active={split} onClick={() => setSplit(true)} title="Side-by-side (split) diff">Split</ToggleBtn>
      </div>
      <EditorToggles />
    </div>
  );
}

function Msg({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`absolute inset-0 flex items-center justify-center text-xs text-dim ${className}`}>{children}</div>;
}
