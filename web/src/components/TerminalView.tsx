import { copyText } from "../lib/clipboard";
import { useCallback, useMemo, useRef, useState, useEffect, type MouseEvent as ReactMouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTerminalSocket } from "../hooks/useTerminalSocket";
import { useSetTerminalMode } from "../hooks/useTerminalMode";
import { useRoom } from "../store/room";
import { useUi, rectOf } from "../store/ui";
import { useToasts } from "../store/toasts";
import { api } from "../api/client";
import type { Workspace } from "../api/types";
import { shellQuote } from "../lib/paths";
import { detectAiTool } from "../lib/autoTitle";
import { FileContextMenu, type FileMenuEntry } from "./Scm/FileContextMenu";
import { TerminalFindBar } from "./TerminalFindBar";
import { confirmModal } from "../store/confirm";

type LinkHit = { kind: "url" | "path"; text: string };

// Per-terminal font-size bounds for the floating zoom control. The default lives in the ui store
// (Settings → Appearance, `terminalFontSize`); these are just the clamp limits.
const FONT_MIN = 8, FONT_MAX = 32;
// Modifier glyphs for the right-click menu hints — match the actual keys: Cmd-C copies on mac, the
// xterm key handler uses Ctrl+Shift+C elsewhere; paste is the browser's Cmd/Ctrl+V.
const IS_MAC = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

export function TerminalView({ terminalId }: { terminalId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Right-click menu: position + the selection AND link-under-cursor captured at open time (a
  // right-click mustn't depend on either surviving the gesture). null = closed.
  const [menu, setMenu] = useState<{ x: number; y: number; selection: string; link: LinkHit | null } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  useEffect(() => setEl(ref.current), []);
  const workspaceId = useRoom((s) => s.workspaceId);

  // The focus bar (theme.css → `.xterm-screen::after`) hangs at the grid's bottom edge. FitAddon
  // floors rows, so the top-aligned grid stops a sub-row short of the pane's bottom, leaving a gap.
  // Measure that gap (pane height − grid height) and publish it as --tr-term-rem so the bar drops by
  // exactly that to sit flush on the pane's bottom edge — WITHOUT moving the grid (text stays put).
  // Observe the screen (resizes on refit/font) and the container (resizes with the dock/window).
  useEffect(() => {
    if (!el) return;
    let ro: ResizeObserver | null = null;
    let raf = 0;
    const sync = (screen: HTMLElement) => {
      // Position the focus bar just under the grid, lifted off the pane's bottom edge by the same
      // breathing room the text gets. Subtract BOTH vertical paddings (--tr-term-pad-y top+bottom):
      // the bar's bottom is screen-bottom + this gap; with both removed the gap is just the floored
      // sub-row remainder, so the bar rests the bottom padding (5px) above the pane edge, rising with
      // the text instead of sitting flush at the very bottom.
      const xterm = el.querySelector(".xterm") as HTMLElement | null;
      const cs = xterm ? getComputedStyle(xterm) : null;
      const padY = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 0;
      const gap = Math.max(0, el.clientHeight - padY - screen.offsetHeight);
      el.style.setProperty("--tr-term-rem", `${gap}px`);
    };
    const attach = () => {
      const screen = el.querySelector(".xterm-screen") as HTMLElement | null;
      if (!screen) { raf = requestAnimationFrame(attach); return; }
      ro = new ResizeObserver(() => sync(screen));
      ro.observe(screen);
      ro.observe(el);
      sync(screen);
    };
    attach();
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [el]);

  // This terminal's font size is a per-terminal OVERRIDE (set by the floating +/− zoom, saved in
  // localStorage keyed by terminal id) layered over the global default from Settings. No override →
  // the pane tracks the global default live, so changing the Settings value re-sizes every terminal
  // you haven't manually zoomed. An override wins and survives refreshes (the tmux session is
  // durable; the preference should be too). Only THIS terminal is ever affected by the zoom.
  const globalFont = useUi((s) => s.terminalFontSize);
  const fontKey = `tr:termFont:${terminalId}`;
  const [fontOverride, setFontOverride] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(fontKey));
    return saved >= FONT_MIN && saved <= FONT_MAX ? saved : null;
  });
  const fontSize = fontOverride ?? globalFont;
  // The rest of the terminal look (font family/weight, line height, letter spacing, padding,
  // scrollback, ligatures) is a global per-device pref from Settings → Appearance → Terminal — no
  // per-terminal override. Bundle it with the resolved font size into one object the socket applies
  // live; memoized so a render that doesn't change the look doesn't re-run the apply effect.
  const fontFamily = useUi((s) => s.terminalFontFamily);
  const fontWeight = useUi((s) => s.terminalFontWeight);
  const lineHeight = useUi((s) => s.terminalLineHeight);
  const letterSpacing = useUi((s) => s.terminalLetterSpacing);
  const padding = useUi((s) => s.terminalPadding);
  const scrollback = useUi((s) => s.terminalScrollback);
  const ligatures = useUi((s) => s.terminalLigatures);
  const appearance = useMemo(
    () => ({ fontSize, fontFamily, fontWeight, lineHeight, letterSpacing, padding, scrollback, ligatures }),
    [fontSize, fontFamily, fontWeight, lineHeight, letterSpacing, padding, scrollback, ligatures],
  );
  const bumpFont = (delta: number) => setFontOverride((prev) => {
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, (prev ?? globalFont) + delta));
    try { localStorage.setItem(fontKey, String(next)); } catch { /* private mode / quota — ignore */ }
    return next;
  });

  // ── Scrollback: copy-all + open the selectable buffer viewer ───────────────────────────────────
  // The in-pane grid can't keep a selection across a scroll (the buffer lives in tmux, not xterm, so
  // scrolling repaints the fixed grid). These pull the full tmux history out as plain text instead:
  // one-tap copy straight to the clipboard, or a draggable window of REAL selectable DOM text.
  const push = useToasts((s) => s.push);
  const [copied, setCopied] = useState(false);
  const copyBuffer = async () => {
    try {
      const { text } = await api.terminalScrollback(terminalId);
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      push(`Copy buffer failed: ${(e as Error).message}`);
    }
  };
  const scrollbackOpenId = useUi((s) => s.scrollbackTerminalId);
  const openScrollback = useUi((s) => s.openScrollback);
  const requestScrollbackClose = useUi((s) => s.requestScrollbackClose);
  const viewBuffer = (e: ReactMouseEvent) => {
    // Toggle: a second press of the button on the same terminal minimizes the open viewer back in.
    if (scrollbackOpenId === terminalId) { requestScrollbackClose(); return; }
    openScrollback(terminalId, rectOf(e.currentTarget));
  };

  // Auto-title needs this terminal's current name (to know if it's still an unnamed placeholder) and
  // its effective launch command (claude/codex → start already waiting for the first prompt). Both
  // come from the cached workspaces query the Room already drives, so this is a free read.
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const ws = data?.workspaces.find((w) => w.id === workspaceId);
  const term = ws?.terminals?.find((t) => t.id === terminalId);
  const title = term?.title ?? "";
  const launchCommand = (term?.launchCommandOverride ?? ws?.launchCommand ?? "").trim();

  // Persist an auto-derived name: optimistically paint it into the cache (instant tab + breadcrumb
  // re-render, no flicker), then PATCH and reconcile on settle — mirrors TerminalList's onColor/onIcon.
  const patchTitle = useMutation({
    // auto:true — this is an auto-derived title, so it leaves the tab unlocked (a user rename, made
    // elsewhere in TerminalList without auto, pins the name and stops the auto-titler overwriting it).
    mutationFn: (next: string) => api.updateTerminal(terminalId, { title: next, auto: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
  const onTitle = useCallback((next: string) => {
    qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
      old ? { ...old, workspaces: old.workspaces.map((w) => ({ ...w, terminals: w.terminals?.map((t) => t.id === terminalId ? { ...t, title: next } : t) })) } : old);
    patchTitle.mutate(next);
  }, [qc, terminalId, patchTitle]);

  // Robust auto-title for an AI session: poll the host for the running session's first prompt (the
  // same transcript source the session browser uses) and name the tab from it — this reads the whole
  // first prompt, so it works even when the prompt wraps over several lines, which the in-pane screen
  // capture (useTerminalSocket) can't. Claude-only server-side; other agents return null and keep the
  // capture path. Runs while the tab is still auto-titled (titleAuto — placeholder OR a prior auto
  // name like a stale "Claude Code"), so it corrects a wrong name but never a user rename. Stops once
  // a title is found, or after ~2 min if no session is ever detected.
  // Pane ⇄ GUI chat, from the floating control cluster. Same mutation the terminal row's context menu
  // uses; this view only ever renders in tmux mode, so the switch here always heads to "gui" (the way
  // back lives on the chat's row in the list). A mid-turn switch 409s and toasts the server's reason.
  const setMode = useSetTerminalMode();
  const mode = term?.mode ?? "tmux";

  const isAiLaunch = !!detectAiTool(launchCommand);
  const titleAuto = term?.titleAuto ?? true;
  const pollsRef = useRef(0);
  const agentTitleQ = useQuery({
    queryKey: ["agentTitle", terminalId],
    queryFn: () => { pollsRef.current++; return api.terminalAgentTitle(terminalId); },
    enabled: isAiLaunch && titleAuto,
    // Poll every second so the tab renames within ~1-2s of the first prompt (the session transcript
    // appears a beat after you hit enter). Stops once named; the count cap (~5 min of active viewing)
    // just bounds the cost if a session is never detected — a remount restarts it.
    refetchInterval: (q) => (q.state.data?.title || pollsRef.current >= 300 ? false : 1000),
    refetchOnWindowFocus: false,
  });
  const detectedTitle = agentTitleQ.data?.title;
  useEffect(() => {
    if (detectedTitle && titleAuto && detectedTitle !== title) onTitle(detectedTitle);
  }, [detectedTitle, titleAuto, title, onTitle]);

  const { sendText, focus, getSelection, selectAll, paste, linkAt, openLink, search, endSearch } =
    useTerminalSocket(terminalId, el, workspaceId, { title, launchCommand, onTitle }, appearance, () => setFindOpen(true));

  // "New Terminal" opens the agent picker (same as the list's +); "Duplicate Terminal" spins up a new
  // one in this workspace with the same launch command and switches to it.
  const openAgentPicker = useRoom((s) => s.openAgentPicker);
  const setActiveTerminal = useRoom((s) => s.setActiveTerminal);
  const dupTerminal = useMutation({
    mutationFn: () => api.createTerminal(workspaceId, { launchCommandOverride: term?.launchCommandOverride ?? null }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["workspaces"] }); setActiveTerminal(r.terminal.id); },
    onError: (e: unknown) => push(e instanceof Error ? e.message : "could not create terminal"),
  });

  // Wipe this terminal's tmux scrollback history (off-screen buffer). Destructive + irreversible, so
  // confirm first; the live screen is untouched (that's what plain Clear / Ctrl+L does).
  const clearScrollback = async () => {
    const ok = await confirmModal({
      title: "Clear scrollback?",
      body: "This wipes this terminal's tmux history (the off-screen buffer). The current screen stays. This can't be undone.",
      confirmLabel: "Clear scrollback",
    });
    if (!ok) return;
    try { await api.clearTerminalScrollback(terminalId); push("Scrollback cleared"); }
    catch (e) { push(`Clear scrollback failed: ${(e as Error).message}`); }
  };

  // The right-click pane menu. Link actions (only when a URL/path sits under the click) come first;
  // Copy uses the selection captured at open time; Copy All / View Buffer reuse the floating-button
  // handlers (the whole tmux scrollback). Clear = Ctrl+L (screen only); Clear Scrollback wipes history.
  const menuItems = (m: { x: number; y: number; selection: string; link: LinkHit | null }): FileMenuEntry[] => {
    const items: FileMenuEntry[] = [];
    if (m.link) {
      const link = m.link;
      items.push(
        { label: link.kind === "url" ? "Open Link" : "Open", onClick: () => openLink(link) },
        { label: link.kind === "url" ? "Copy Link" : "Copy Path", onClick: () => copyText(link.text) },
        "sep",
      );
    }
    items.push(
      { label: "Copy", hint: IS_MAC ? "⌘C" : "⌃⇧C", disabled: !m.selection,
        onClick: () => { if (m.selection) copyText(m.selection); } },
      { label: "Paste", hint: IS_MAC ? "⌘V" : "⌃V", onClick: () => void paste() },
      { label: "Select All", onClick: selectAll },
      "sep",
      { label: "Find…", hint: IS_MAC ? "⌘F" : "⌃⇧F", onClick: () => setFindOpen(true) },
      "sep",
      { label: "New Terminal", onClick: openAgentPicker },
      { label: "Duplicate Terminal", onClick: () => dupTerminal.mutate() },
      "sep",
      { label: "Copy All", onClick: () => void copyBuffer() },
      { label: "View Buffer", onClick: () => openScrollback(terminalId, { x: m.x, y: m.y, w: 0, h: 0 }) },
      "sep",
      { label: "Clear", hint: "⌃L", onClick: () => sendText("\x0c") },
      { label: "Clear Scrollback", onClick: () => void clearScrollback() },
    );
    return items;
  };

  // Publish this terminal's input sender to the room so the mic button can inject transcribed
  // text into it. sendText's identity changes each render, so register a stable wrapper that
  // reads the latest via a ref. Cleared on unmount (when the active terminal switches away).
  const setTerminalSender = useRoom((s) => s.setTerminalSender);
  const sendRef = useRef(sendText);
  sendRef.current = sendText;
  useEffect(() => {
    const send = (text: string) => sendRef.current(text);
    setTerminalSender(send);
    return () => setTerminalSender(null);
  }, [setTerminalSender, terminalId]);

  return (
    <div
      // tr-pane draws the subtle active-pane ring (matches the other panels) on :focus-within; the
      // green bar under the grid (theme.css → `.tr-pane .xterm-screen::after`, shown on :focus-within)
      // is the stronger "taking input" cue that survives agent TUIs. Both are pure CSS — no JS focus
      // state to track. The xterm grid is inset + centered by --tr-term-pad (theme.css → `.tr-pane
      // .xterm`), so the text isn't flush against the pane border; FitAddon reads that padding and
      // recomputes cols. Dragging a path over the pane adds a light blue drop-target ring (transient).
      className={`w-full h-full relative tr-pane ${dragOver ? "ring-2 ring-blue-500/60 ring-inset" : ""}`}
      // Any click in the pane (including padding/empty rows, or right after switching terminals
      // from the list) lands focus on xterm, so it starts taking input and the ring lights up.
      onPointerDown={() => focus()}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, selection: getSelection(), link: linkAt(e.clientX, e.clientY) }); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("text/plain")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const path = e.dataTransfer.getData("text/plain");
        if (path) sendText(shellQuote(path) + " ");
      }}
    >
      <div ref={ref} className="w-full h-full" />
      {/* Floating controls — faint until hovered. preventDefault on mousedown keeps focus in xterm so
          clicking one doesn't drop the green focus bar. 2×3 grid: zoom +/− on the top row, copy-buffer
          and view-buffer next, then the pane/chat surface switch. The bg-edge grid with gap-px paints
          the 1px separators between cells. */}
      <div
        onMouseDown={(e) => e.preventDefault()}
        // right-3 (12px) lines the cluster up with the terminal's content padding (--tr-term-pad) so
        // it sits inside the text column instead of hanging out in the right margin.
        className="pointer-events-auto absolute top-1.5 right-3 z-20 grid grid-cols-2 gap-px rounded-md overflow-hidden border border-edge bg-edge text-muted shadow-md opacity-40 hover:opacity-100 transition-opacity"
      >
        <button onClick={() => bumpFont(1)} title="Bigger text" aria-label="Increase terminal font size"
          disabled={fontSize >= FONT_MAX}
          className="w-6 h-6 inline-flex items-center justify-center leading-none text-base bg-panel/85 hover:bg-surface hover:text-bright disabled:opacity-30 disabled:hover:bg-panel/85">+</button>
        <button onClick={() => bumpFont(-1)} title="Smaller text" aria-label="Decrease terminal font size"
          disabled={fontSize <= FONT_MIN}
          className="w-6 h-6 inline-flex items-center justify-center leading-none text-base bg-panel/85 hover:bg-surface hover:text-bright disabled:opacity-30 disabled:hover:bg-panel/85">−</button>
        <button onClick={copyBuffer} title="Copy the whole terminal buffer" aria-label="Copy terminal buffer"
          className="w-6 h-6 inline-flex items-center justify-center bg-panel/85 hover:bg-surface hover:text-bright">
          {copied ? <CheckGlyph /> : <CopyGlyph />}</button>
        <button onClick={viewBuffer} title="Open the buffer in a selectable window" aria-label="View terminal buffer"
          className={`w-6 h-6 inline-flex items-center justify-center hover:bg-surface hover:text-bright ${scrollbackOpenId === terminalId ? "bg-surface text-bright" : "bg-panel/85"}`}>
          <BufferGlyph /></button>
        {/* Surface switch: this pane (left) vs the in-app Claude chat (right). A segmented pair rather
            than one toggle so the terminal you're looking at is always the lit half — the same
            active treatment the buffer button uses. */}
        <button onClick={() => setMode.mutate({ id: terminalId, mode: "tmux" })} disabled={mode === "tmux" || setMode.isPending}
          title="Terminal pane" aria-label="Show the terminal pane" aria-pressed={mode === "tmux"}
          className={segmentClass(mode === "tmux", setMode.isPending)}>
          <PaneGlyph /></button>
        <button onClick={() => setMode.mutate({ id: terminalId, mode: "gui" })} disabled={mode === "gui" || setMode.isPending}
          title="Open in GUI chat" aria-label="Switch to the in-app agent chat" aria-pressed={mode === "gui"}
          className={segmentClass(mode === "gui", setMode.isPending)}>
          <ChatGlyph /></button>
      </div>
      {menu && (
        <FileContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} dismiss={() => setMenu(null)} />
      )}
      {findOpen && (
        <TerminalFindBar onSearch={search} onClose={() => { setFindOpen(false); endSearch(); }} />
      )}
    </div>
  );
}

/** One half of the pane/chat surface switch. The segment you're currently on stays lit and inert (no
 *  hover shift — there's nothing to switch to); the other one lights on hover like the buttons above
 *  it, and dims while a switch is in flight. */
function segmentClass(on: boolean, pending: boolean): string {
  return `w-6 h-6 inline-flex items-center justify-center
    ${on ? "bg-surface text-bright" : "bg-panel/85 hover:bg-surface hover:text-bright"}
    ${pending ? "opacity-50" : ""}`;
}

/** A prompt chevron over a caret — the "this is a shell pane" glyph. */
function PaneGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
      <path d="m5 7 4 4-4 4M13 15h6" />
    </svg>
  );
}

/** A speech bubble — the "in-app chat" glyph, paired with PaneGlyph in the surface switch. */
function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

/** Two overlapping sheets — the copy/duplicate glyph. */
function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

/** A checkmark — brief confirmation that the buffer was copied. */
function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-green-400" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Stacked text lines in a frame — the "view the text buffer" glyph. */
function BufferGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </svg>
  );
}
