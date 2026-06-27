import { useContext, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { api, getToken } from "../api/client";
import { useXtermTheme } from "../theme/useTheme";
import { basename, shellQuote } from "../lib/paths";
import { RoomContext } from "../store/room";
import { useToasts } from "../store/toasts";
import { createTerminalLinkProvider, findLinkAt, parsePathToken } from "../lib/terminalLinks";
import { isLoopbackHost, parseLocalhostUrl, absolutePreviewUrl } from "../lib/preview";
import { useUi } from "../store/ui";
import { isTabActive } from "../lib/tabActive";
import { detectAiTool, firstLine, isPlaceholderTitle, resolveAutoTitle, stripPrompt } from "../lib/autoTitle";
import { DEFAULT_TERM_FONT } from "../lib/terminalFonts";

// Per-terminal visual settings (Settings → Appearance → Terminal). Per-browser, applied live. The
// defaults reproduce the historical hardcoded look exactly, so an unconfigured terminal is unchanged.
export interface TerminalAppearance {
  fontSize: number;       // px (a per-terminal zoom override may win — TerminalView resolves it)
  fontFamily: string;     // full CSS font-family string
  fontWeight: number;     // 300–700
  lineHeight: number;     // row height multiplier, ≥ 1
  letterSpacing: number;  // whole px between glyphs
  padding: number;        // horizontal pane padding in px (--tr-term-pad; vertical derived ~0.42×)
  scrollback: number;     // xterm in-pane buffer lines
  ligatures: boolean;     // enable font ligatures via font-feature-settings (best-effort, font-dependent)
}

export const DEFAULT_TERM_APPEARANCE: TerminalAppearance = {
  fontSize: 13, fontFamily: DEFAULT_TERM_FONT, fontWeight: 400, lineHeight: 1,
  letterSpacing: 0, padding: 12, scrollback: 1000, ligatures: false,
};

// Vertical pane padding follows the horizontal one at the historical ratio (12px → 5px) so the grid
// keeps its proportions as the user drags the padding slider.
const padY = (px: number) => Math.max(0, Math.round(px * 0.42));
const ligatureValue = (on: boolean) => (on ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // mirrors the server cap
const PING_EVERY_MS = 25_000;             // keepalive cadence (under typical ~100s proxy idle timeouts)
const PONG_TIMEOUT_MS = 8_000;            // no pong within this → treat socket as dead, reconnect
const MAX_BACKOFF_MS = 5_000;             // matches useClaudeActivity's reconnect cap

export function useTerminalSocket(
  terminalId: string,
  container: HTMLDivElement | null,
  workspaceId: string,
  autoTitle?: { title?: string; launchCommand?: string; onTitle?: (title: string) => void },
  appearance: TerminalAppearance = DEFAULT_TERM_APPEARANCE,
  onFind?: () => void, // Cmd/Ctrl-F (or the right-click "Find…") opens the in-pane find bar
) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // The link openers are defined inside the (terminal-creating) effect where the room store + resolve
  // wiring live; mirror them into refs so the right-click menu's "Open Link" can fire the same logic
  // from outside the effect (without the Cmd/Ctrl guard the hover-click path enforces).
  const openUrlRef = useRef<(url: string) => void>(() => {});
  const openPathRef = useRef<(token: string) => void>(() => {});
  // Cmd/Ctrl-F handler, in a ref so the effect's key handler reads the latest without re-running.
  const onFindRef = useRef(onFind);
  onFindRef.current = onFind;

  // Live appearance for this pane, in a ref so the (terminal-creating) effect seeds the new Terminal
  // with the latest without re-running on a change; a dedicated effect re-applies + refits below.
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;

  // Active theme's xterm colors. Held in a ref so the (terminal-creating) effect below reads the
  // latest without re-running on every theme change; a dedicated effect re-applies live instead.
  const xtheme = useXtermTheme();
  const xthemeRef = useRef(xtheme);
  xthemeRef.current = xtheme;

  // Auto-title inputs, held in refs so the creation effect reads the latest without re-running (and
  // tearing down xterm) when the title/handler identity changes. The waiting-for-AI-prompt flag
  // itself lives in the room store, NOT here, so it survives this hook's remount on a tab switch.
  const roomStore = useContext(RoomContext);
  const titleRef = useRef(autoTitle?.title ?? "");
  titleRef.current = autoTitle?.title ?? "";
  const launchCmdRef = useRef(autoTitle?.launchCommand ?? "");
  launchCmdRef.current = autoTitle?.launchCommand ?? "";
  const onTitleRef = useRef(autoTitle?.onTitle);
  onTitleRef.current = autoTitle?.onTitle;

  useEffect(() => {
    if (!container) return;
    const a0 = appearanceRef.current;
    const term = new Terminal({
      fontSize: a0.fontSize,
      // Font family/weight/line-height/spacing/scrollback are user prefs (Settings → Appearance →
      // Terminal); defaults reproduce the historical look. The Nerd Font stays in the stack so
      // powerline/devicon glyphs (coralline/p10k statuslines) render instead of tofu. A dedicated
      // effect below re-applies these live when the user changes them.
      fontFamily: a0.fontFamily,
      fontWeight: a0.fontWeight as Terminal["options"]["fontWeight"],
      lineHeight: a0.lineHeight,
      letterSpacing: a0.letterSpacing,
      scrollback: a0.scrollback,
      // Background/foreground/cursor + the 16 ANSI colors come from the active theme (web/src/theme).
      // The dedicated effect below re-applies them live when the user switches themes.
      theme: xthemeRef.current,
      cursorBlink: true,
      // When this pane is NOT focused, still show the caret as a steady (non-blinking) solid block
      // — not xterm's default hollow "outline" and not hidden. So: focused = blinking block,
      // unfocused = steady block. Blink is the "this pane is live and taking input" signal.
      cursorInactiveStyle: "block",
      // tmux mouse mode is off, so a plain drag selects natively. If an app inside (an agent TUI)
      // grabs the mouse, holding ⌥ (mac) / Shift still forces a local text selection — matching
      // Terminal.app / iTerm behaviour.
      macOptionClickForcesSelection: true,
    });
    const fit = new FitAddon(); term.loadAddon(fit);
    term.open(container);
    // Seed the CSS-driven appearance (pane padding + ligatures) BEFORE the first fit so cols/rows are
    // computed against the user's padding, not the :root default — avoids a one-frame reflow on open.
    container.style.setProperty("--tr-term-pad", `${a0.padding}px`);
    container.style.setProperty("--tr-term-pad-y", `${padY(a0.padding)}px`);
    container.style.fontFeatureSettings = ligatureValue(a0.ligatures);
    // Renderer: xterm's default DOM renderer — we deliberately do NOT load the WebGL (or canvas) addon.
    // The WebGL renderer reallocates its GPU canvas on every resize, blanking for a frame; dragging the
    // window edge fired that realloc each frame → a fast flicker. The DOM renderer reflows cells in
    // place with no such flash, so the live RAF-coalesced refit above stays smooth (this is what the
    // t3code reference terminal does). Trade-off: DOM costs more CPU per cell than WebGL on machines
    // without free GPU canvas accel, but it's plenty for an agent TUI. To revert: `npm i -w web
    // @xterm/addon-webgl` (the v6-compatible release), import WebglAddon, and load it after term.open().
    fit.fit(); term.focus();
    termRef.current = term; fitRef.current = fit;

    // ── Auto-title ──────────────────────────────────────────────────────────────────────────────
    // Terminal Hub auto-launches the agent (claude by default) at creation via send-keys, so the user is
    // dropped straight into it without ever typing `claude`. Treat that exactly like the spec's typed
    // AI launch: if this still-unnamed terminal's launch command IS an AI CLI, start already waiting
    // for the first prompt, so it self-names "Claude - <prompt>". Seed once only (absent key =
    // untouched) so a tab-switch remount can't reset a waiting/already-named terminal.
    if (roomStore) {
      const seedTool = detectAiTool(launchCmdRef.current);
      if (seedTool && isPlaceholderTitle(titleRef.current) && roomStore.getState().aiAwait[terminalId] === undefined) {
        roomStore.getState().setAiAwait(terminalId, seedTool);
      }
    }
    // A committed line (plain Enter, or a paste) names the tab from the first command — unless that
    // command launches an AI CLI, in which case we wait and name it from the next line, prefixed with
    // the tool. `cmd` is already extracted (prompt-stripped for a typed line; raw first paste line).
    const commitLine = (cmd: string) => {
      if (!roomStore || !onTitleRef.current) return;
      if (!isPlaceholderTitle(titleRef.current)) return; // armed only while still a placeholder name
      const waiting = roomStore.getState().aiAwait[terminalId] ?? null;
      const next = resolveAutoTitle(cmd, waiting);
      if (!next) return;                                  // empty line: stay armed
      if (next.kind === "wait") { roomStore.getState().setAiAwait(terminalId, next.tool); return; }
      // Claude tabs are named from the session transcript (TerminalView polls /agent-title) — that
      // reads the full first prompt even when it wraps, which this on-screen capture can't. So stay
      // armed and skip naming for Claude; other agents + plain commands name from the captured line.
      if (waiting === "Claude") return;
      roomStore.getState().setAiAwait(terminalId, null);  // named: clear the waiting flag
      onTitleRef.current(next.title);
    };

    // ── Scrollback cursor ─────────────────────────────────────────────────────────────────────────
    // Scrolling up parks tmux in copy-mode, whose caret tracks the scroll position — so the cursor
    // wanders up into the history (un-editable) region. A native terminal shows no cursor while you're
    // scrolled back. Mirror that: track how far we've scrolled from the live bottom (in lines we've
    // sent) and, while parked in history, paint the cursor in the background colour so it vanishes (and
    // cursorAccent in the foreground colour so the glyph it sits on still reads as a normal cell). The
    // first keystroke snaps back to live (the server exits copy-mode), so restore the cursor there too.
    let scrollOffset = 0; // lines scrolled up from the live bottom; 0 = at the prompt
    const hideCursor = () => {
      const t = xthemeRef.current;
      term.options.theme = { ...t, cursor: t.background, cursorAccent: t.foreground };
    };
    const showCursor = () => { term.options.theme = xthemeRef.current; };

    // ── Snap to live on input ───────────────────────────────────────────────────────────────────────
    // Wheel-scroll state lives here (next to scrollOffset) so onData can call snapToLive() before the
    // wheel bridge below wires these up. Typing OR pasting while scrolled back must return to the live
    // prompt and STAY there: reset the local offset, drop any queued/unflushed wheel ticks, and briefly
    // ignore further wheel events so trailing trackpad inertia can't re-enter tmux copy-mode and bounce
    // the view (and the input we just sent) back up into history — the bug where a paste "wouldn't go in".
    let pendingLines = 0;                       // wheel ticks awaiting a coalesced flush
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let suppressWheelUntil = 0;                 // ignore the wheel until this time (kills post-input inertia)
    const snapToLive = () => {
      pendingLines = 0;
      if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null; }
      suppressWheelUntil = Date.now() + 250;
      if (scrollOffset) { scrollOffset = 0; showCursor(); }
    };

    // OSC 52 → browser clipboard. With tmux mouse mode off, a plain drag is a native xterm
    // selection that copy-on-select / Cmd-C already mirror to the clipboard. This covers the other
    // path: tools running INSIDE the terminal (tmux copy-mode yank, vim with clipboard=unnamed,
    // etc.) that emit OSC 52 (ESC ] 52 ; <sel> ; <base64> BEL) to set the clipboard — handy over a
    // remote tunnel. xterm.js drops OSC 52 unless a handler is registered, so decode the payload
    // (base64 → UTF-8) and write it. Read requests (payload "?") are ignored so nothing running in
    // the terminal can exfiltrate the clipboard.
    term.parser.registerOscHandler(52, (data) => {
      const sep = data.indexOf(";");
      const payload = sep === -1 ? "" : data.slice(sep + 1);
      if (!payload || payload === "?") return true;
      try {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
        void navigator.clipboard?.writeText(new TextDecoder().decode(bytes)).catch(() => {});
      } catch { /* malformed base64 — ignore */ }
      return true;
    });

    // ── Keep the focused caret blinking ───────────────────────────────────────────────────────────
    // cursorBlink:true only blinks while the OPTION is true, but xterm lets the running program turn
    // it off: DECSCUSR (`CSI Ps SP q`) with an even Ps, and DECRST 12 (`CSI ? 12 l`) both set
    // cursorBlink=false. zsh's line editor (also tmux/vim) emits one right after the first prompt, so
    // the caret blinks once then goes steady. Terminal Hub wants the focused caret to ALWAYS blink, so
    // honor the cursor SHAPE the app asks for but force blink back on.
    const forceBlink = () => { term.options.cursorBlink = true; };
    // DECSCUSR — Ps: 0/1 block, 2 block, 3/4 underline, 5/6 bar (even = steady, which we ignore).
    term.parser.registerCsiHandler({ intermediates: " ", final: "q" }, (params) => {
      const ps = (params[0] as number) || 1;
      term.options.cursorStyle = ps <= 2 ? "block" : ps <= 4 ? "underline" : "bar";
      forceBlink();
      return true; // overrides xterm's built-in, which would flip blink off on an even Ps
    });
    // DEC private mode 12 toggles blink. Block only a lone `?12l`/`?12h` (re-assert blink); fall
    // through for every other DEC mode so cursor-visibility (?25), alt-screen (?1049), bracketed
    // paste (?2004), etc. keep their default behavior.
    // Track whether a foreground app has grabbed the mouse (DEC private modes 1000/1002/1003) so
    // the wheel bridge below knows whether to drive tmux scrollback (no app) or stay out of the way
    // (app present, let xterm forward the wheel to it). Observe only — return false so xterm still
    // actually enters/leaves mouse mode.
    let appMouseOn = false;
    for (const final of ["h", "l"] as const) {
      term.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
        if (params.some((p) => p === 1000 || p === 1002 || p === 1003)) appMouseOn = final === "h";
        if (params.length === 1 && params[0] === 12) { forceBlink(); return true; }
        return false;
      });
    }

    // ── Socket lifecycle ────────────────────────────────────────────────────────────────────────
    // The tmux session is durable; only this browser↔server attach socket is fragile (server
    // restarts, idle tunnel timeouts, sleep/wake, network blips). Without reconnect the terminal
    // silently eats input — `send()` drops anything written while the socket isn't OPEN. So mirror
    // the proven reconnect pattern from useClaudeActivity, plus keepalive + wake-on-visible.
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let pongWatch: ReturnType<typeof setTimeout> | null = null;
    let closed = false;   // component unmounted — stop everything
    let ended = false;    // server sent {exit}: the session genuinely ended, do not reconnect
    let announced = false;
    let attempt = 0;

    // Every send funnels through the CURRENT socket (wsRef.current), never a captured `ws`, so a
    // reconnect actually restores typing and not just output.
    const send = (obj: unknown) => {
      const s = wsRef.current;
      if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify(obj));
    };

    // Refit xterm to the container, coalesced to one fit per paint frame (requestAnimationFrame) so a
    // drag-resize tracks the container smoothly rather than lagging behind a debounce or flashing every
    // frame. FitAddon.fit() only resizes the grid when the container crosses a whole cell, and the DOM
    // renderer reflows those cells without the blank-frame flash a WebGL canvas-realloc causes (that
    // flash is why we no longer load the WebGL addon — see term.open below). We message tmux only when
    // cols/rows actually change, so the running TUI (Claude et al.) gets the minimum number of SIGWINCH
    // repaints, and we pin the viewport to the bottom across the reflow so resizing never scrolls off
    // the live prompt. This mirrors how smooth reference terminals (t3code) handle resize.
    let resizeRaf = 0;
    let lastCols = term.cols, lastRows = term.rows;
    const doResize = () => {
      resizeRaf = 0;
      if (!container.clientWidth || !container.clientHeight) return; // hidden/zero-size: skip
      const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
      fit.fit();
      if (atBottom) term.scrollToBottom();
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols; lastRows = term.rows;
        send({ type: "resize", cols: term.cols, rows: term.rows });
      }
    };
    const scheduleResize = () => { if (!resizeRaf) resizeRaf = requestAnimationFrame(doResize); };

    const stopHeartbeat = () => {
      if (ping) { clearInterval(ping); ping = null; }
      if (pongWatch) { clearTimeout(pongWatch); pongWatch = null; }
    };

    const connect = () => {
      if (closed || ended) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const tok = getToken();
      ws = new WebSocket(`${proto}://${location.host}/ws/terminal/${terminalId}?cols=${term.cols}&rows=${term.rows}${tok ? `&token=${encodeURIComponent(tok)}` : ""}`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        if (announced) { term.write("\r\n[reconnected]\r\n"); announced = false; }
        lastCols = -1; lastRows = -1; // a fresh attach must always be told the size, even if unchanged
        doResize(); // re-sync size; tmux attach repaints the current screen
        stopHeartbeat();
        ping = setInterval(() => {
          send({ type: "ping" });
          if (pongWatch) clearTimeout(pongWatch);
          pongWatch = setTimeout(() => { try { ws?.close(); } catch { /* will fire onclose */ } }, PONG_TIMEOUT_MS);
        }, PING_EVERY_MS);
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "output") { term.write(msg.data); }
        else if (msg.type === "pong") { if (pongWatch) { clearTimeout(pongWatch); pongWatch = null; } }
        else if (msg.type === "exit") { ended = true; term.write("\r\n[session ended]\r\n"); }
      };

      ws.onclose = (ev) => {
        stopHeartbeat();
        if (closed || ended) return;
        // 1008 unauthorized / 1011 terminal-not-found are terminal states — retrying just loops.
        if (ev.code === 1008 || ev.code === 1011) { term.write("\r\n[disconnected]\r\n"); return; }
        if (!announced) { term.write("\r\n[reconnecting…]\r\n"); announced = true; }
        attempt++;
        retry = setTimeout(connect, Math.min(1000 * attempt, MAX_BACKOFF_MS));
      };
    };

    // Tab came back to foreground or the network returned: if the socket is gone, reconnect now
    // instead of waiting out the backoff.
    const wake = () => {
      if (closed || ended) return;
      if (!ws || ws.readyState > WebSocket.OPEN) { // CLOSING (2) or CLOSED (3)
        if (retry) { clearTimeout(retry); retry = null; }
        attempt = 0;
        connect();
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") wake(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", wake);

    connect();

    // ── Pane focus + attention bell ───────────────────────────────────────────────────────────────
    // Track whether THIS pane holds xterm focus (the green :focus-within bar) in a tiny global flag.
    // term.open() put xterm's textarea inside `container`, so focusin/focusout on the container catch
    // it. This is the real "am I in this terminal" signal the notification layer reads — clicking off
    // the pane (onto the canvas, a panel, another room) drops it even though the room stays open.
    const onFocusIn = () => useUi.getState().setFocusedTerminal(terminalId);
    const onFocusOut = (e: FocusEvent) => {
      if (container.contains(e.relatedTarget as Node | null)) return; // focus moved within this pane
      if (useUi.getState().focusedTerminalId === terminalId) useUi.getState().setFocusedTerminal(null);
    };
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    if (container.contains(document.activeElement)) useUi.getState().setFocusedTerminal(terminalId); // term.focus() above

    // An agent rings the terminal bell when it finishes a turn or needs you (a permission/decision
    // prompt). When this pane ISN'T the one you're in — another room/space/tab/app, or you just
    // clicked off it so there's no green bar — ping the server to fire the same "needs attention" toast
    // you'd get if the room were closed. (A closed/detached terminal goes through tmux's bell flag
    // server-side instead; this covers the open+attached case, where the attach clears that flag so the
    // watcher is blind to it. The two paths partition by attach state, so one bell never double-fires.)
    // Attention is bell-only: the bell + OSC-notify codes are the deliberate "I'm done" signal that
    // fires the toast. A pane merely going quiet no longer notifies (it flagged every idle agent).
    const notFocused = () => !(isTabActive() && useUi.getState().focusedTerminalId === terminalId);
    const fireExplicit = (message?: string) => {
      if (!notFocused()) return; // you're in it → no toast
      api.notifyTerminalAttention(terminalId, message).catch(() => {});
    };
    const bellSub = term.onBell(() => fireExplicit());

    // OSC desktop-notification escape codes many TUIs emit, turned into the same attention toast and
    // carrying the tool's own text: OSC 9 ("<message>") and OSC 777 ("notify;<title>;<body>"). Return
    // true to mark them handled so they don't print as garbage. (Open-room only — a detached session
    // has no reader; closed rooms fall back to the bell + silence flags.)
    const osc9 = term.parser.registerOscHandler(9, (data) => { fireExplicit(data?.trim() || undefined); return true; });
    const osc777 = term.parser.registerOscHandler(777, (data) => {
      const parts = data.split(";");
      if (parts[0] !== "notify") return false; // not a notification payload — let xterm handle it
      fireExplicit((parts[2] || parts[1] || "").trim() || undefined);
      return true;
    });

    term.onData((d) => {
      snapToLive(); // typing snaps back to the live view and cancels any trailing wheel inertia
      send({ type: "input", data: d });
    });

    // Cmd/Ctrl-C copies the xterm selection (xterm has no native copy — its hidden textarea holds
    // no selection). Only swallow the key when there's actually a selection, so a real Ctrl-C
    // still sends SIGINT. Paste is intentionally left to xterm's built-in `paste` handler — adding
    // our own would fire alongside it and paste twice.
    const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const copyMod = isMac ? e.metaKey : e.ctrlKey && e.shiftKey;
      if (copyMod && e.key.toLowerCase() === "c") {
        const sel = term.getSelection();
        if (sel) { void navigator.clipboard?.writeText(sel).catch(() => {}); return false; }
      }
      // Cmd-F (mac) / Ctrl+Shift+F (else) opens the in-pane find bar. Ctrl-F alone is left to the
      // shell (readline forward-char), so it's only claimed with Shift off mac.
      const findMod = isMac ? e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey;
      if (findMod && e.key.toLowerCase() === "f") { onFindRef.current?.(); return false; }
      // Shift+Enter inserts a newline instead of submitting. A classic terminal sends the same byte
      // (CR, 0x0D) for both Enter and Shift+Enter, and this xterm.js predates Kitty-protocol support
      // so it can't encode the modifier — the agent only ever sees "Enter" and submits. Inject
      // Ctrl+J (LF, 0x0A) instead, the universal newline Claude Code documents (CR=submit,
      // LF=newline), and preventDefault so xterm's hidden textarea can't emit its own CR that would
      // still submit after we return false.
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        send({ type: "input", data: "\n" });
        return false;
      }
      // Plain Enter commits the current line → capture it for auto-titling. Read the line VISUALLY
      // from the buffer at the cursor (not from keystrokes) so tab-completion, history recall, and
      // arrow-key edits are captured correctly; then strip the shell prompt. Only PLAIN Enter (no
      // modifiers) commits. Returns true below so the keystroke still submits as normal.
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const buf = term.buffer.active;
        const line = buf.getLine(buf.baseY + buf.cursorY);
        if (line) commitLine(stripPrompt(line.translateToString(true)));
      }
      return true;
    });

    // ── Cmd/Ctrl-click a link → open it ───────────────────────────────────────────────────────────
    // Underline URLs and path-shaped tokens only while the modifier is held (VS Code / Zed feel).
    // Paths: ask the server to resolve the token — relative paths against the pane's LIVE cwd, ~ to
    // the host home — then open the file in the editor (or jump to file:line), reveal a folder in the
    // explorer, or toast a miss (works over a remote tunnel since the server reads the bytes). URLs
    // (http/https): open in a new browser tab. The link provider (lib/terminalLinks) stays pure; the
    // async resolve+open lives here where the room store is.
    let modHeld = false;
    // Discovery runs only while the modifier is held — but xterm re-queries link providers only on a
    // mouse MOVE. So pressing Cmd/Ctrl while the pointer already rests on a link wouldn't light it up
    // (no move → no re-query → no underline → the click has nothing to fire). Track the live pointer
    // and, the instant the modifier flips, replay a synthetic mousemove there so xterm re-evaluates the
    // link under the cursor right away (and clears it on release) — the point-then-Cmd-then-click feel.
    let lastPointer: { x: number; y: number } | null = null;
    const trackPointer = (e: MouseEvent) => { lastPointer = { x: e.clientX, y: e.clientY }; };
    const reLinkify = () => {
      if (!lastPointer) return;
      const el = document.elementFromPoint(lastPointer.x, lastPointer.y);
      if (el && container.contains(el))
        el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: lastPointer.x, clientY: lastPointer.y }));
    };
    const onModKey = (e: KeyboardEvent) => {
      const next = isMac ? e.metaKey : e.ctrlKey;
      if (next === modHeld) return; // skip keydown auto-repeat; only act on the actual press/release flip
      modHeld = next;
      reLinkify();
    };
    const onBlurClearMod = () => { if (modHeld) { modHeld = false; reLinkify(); } };
    container.addEventListener("mousemove", trackPointer);
    window.addEventListener("keydown", onModKey);
    window.addEventListener("keyup", onModKey);
    window.addEventListener("blur", onBlurClearMod);
    // Core openers (no modifier guard) — shared by the Cmd/Ctrl-hover-click path (which adds the
    // guard) and the right-click "Open Link" menu (which doesn't, since the user picked it explicitly).
    const doOpenPath = (token: string) => {
      const parsed = parsePathToken(token);
      if (!parsed || !roomStore) return;
      const store = roomStore;
      api.resolveTerminalPath(workspaceId, terminalId, parsed.path)
        .then(({ path, type }) => {
          if (type === "file") {
            if (parsed.line) store.getState().jumpToLine({ path, name: basename(path) }, parsed.line);
            else store.getState().openFile({ path, name: basename(path) });
          } else if (type === "dir") {
            store.getState().revealInExplorer(path);
          } else {
            useToasts.getState().push(`Not found: ${parsed.path}`);
          }
        })
        .catch((err) => useToasts.getState().push(err instanceof Error ? err.message : "could not open path"));
    };
    const doOpenUrl = (url: string) => {
      const loc = parseLocalhostUrl(url);
      if (loc) {
        // Reached remotely, a localhost link points at the HOST (not the viewer's machine), so it's
        // unreachable in a normal tab — route it into the in-app Localhost browser.
        if (!isLoopbackHost()) { useUi.getState().openLocalhostPort(loc.port, loc.path); return; }
        // On loopback localhost IS the viewer's machine, so open a real tab — but via the `localhost`
        // NAME (absolutePreviewUrl normalizes it): a raw http://127.0.0.1 link can't fall over to a
        // dev server bound only to ::1 (Vite's default), whereas the browser resolves both families.
        window.open(absolutePreviewUrl(loc.port, loc.path), "_blank", "noopener,noreferrer");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    };
    openPathRef.current = doOpenPath;
    openUrlRef.current = doOpenUrl;
    const hasMod = (event: MouseEvent) => (isMac ? event.metaKey : event.ctrlKey);
    const openPath = (event: MouseEvent, token: string) => { if (hasMod(event)) doOpenPath(token); };
    const openUrl = (event: MouseEvent, url: string) => { if (hasMod(event)) doOpenUrl(url); };
    const linkProvider = term.registerLinkProvider(createTerminalLinkProvider(term, () => modHeld, { openPath, openUrl }));

    // Copy-on-select: when a drag finishes with text selected, mirror it to the clipboard so
    // Cmd/Ctrl-C is optional (the common web-terminal convenience).
    const onMouseUp = () => {
      const sel = term.getSelection();
      if (sel) void navigator.clipboard?.writeText(sel).catch(() => {});
    };
    container.addEventListener("mouseup", onMouseUp);

    // ── Wheel → tmux scrollback ───────────────────────────────────────────────────────────────────
    // Mouse mode is off (so drags select natively), which means the wheel no longer reaches tmux.
    // Bridge it: when no foreground app owns the mouse, translate wheel ticks into copy-mode scroll
    // over the socket; when an app does (appMouseOn — e.g. an agent TUI), do nothing so xterm
    // forwards the wheel and the app scrolls itself. Line counts come from the MEASURED row height
    // (px ÷ rows), not a guessed pixels-per-line. Coalesce on a short timer so a fast scroll doesn't
    // spawn a tmux process per wheel event. (pendingLines/scrollTimer/suppressWheelUntil + snapToLive
    // are declared above with the other scroll state.)
    const flushScroll = () => {
      scrollTimer = null;
      const lines = pendingLines; pendingLines = 0;
      if (!lines) return;
      send({ type: "scroll", lines });
      const prev = scrollOffset;
      scrollOffset = Math.max(0, scrollOffset + lines); // +lines = up into history, -lines = toward live
      if (scrollOffset > 0 && prev === 0) hideCursor();
      else if (scrollOffset === 0 && prev > 0) showCursor();
    };
    const onWheel = (e: WheelEvent) => {
      if (appMouseOn) return; // a foreground app owns the mouse — let xterm forward the wheel to it
      // Just typed/pasted: swallow trailing trackpad inertia so it can't re-park copy-mode and bounce
      // the view (and the input) back up. Eat the event entirely (no tmux scroll, no xterm arrow keys).
      if (Date.now() < suppressWheelUntil) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      const rowPx = container.clientHeight / Math.max(1, term.rows);
      if (!(rowPx > 0)) return; // not laid out yet
      e.preventDefault();
      e.stopImmediatePropagation(); // and don't let xterm translate the wheel into arrow keys
      // tmux repaints the scrolled view into the same fixed alt-screen grid, so a prior selection
      // would sit over whatever text now occupies those cells — it can't "follow" content that lives
      // in tmux's scrollback rather than xterm's buffer. The drag already copied to the clipboard, so
      // drop the now-meaningless highlight instead of leaving it stuck to the screen.
      if (term.hasSelection()) term.clearSelection();
      const lineDelta = e.deltaMode === 1 ? e.deltaY            // already in lines (Firefox)
        : e.deltaMode === 2 ? e.deltaY * term.rows              // pages
        : e.deltaY / rowPx;                                    // pixels
      pendingLines += Math.round(-lineDelta); // wheel up (deltaY<0) → +lines = back into history
      if (!scrollTimer) scrollTimer = setTimeout(flushScroll, 40);
    };
    container.addEventListener("wheel", onWheel, { passive: false, capture: true });

    // Image paste. The clipboard image lives in the browser but the agent runs on the host, so we
    // upload the bytes and drop the host path the server returns at the cursor (so it works over a
    // remote tunnel too). Only image pastes are intercepted — plain text stays on xterm's native
    // paste. Capture phase so we beat xterm's hidden textarea.
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) {
        // Text paste: let xterm paste it as usual, but capture its first line for auto-titling — a
        // paste counts as a committed line (no shell prompt to strip on raw pasted text).
        const text = e.clipboardData?.getData("text") ?? "";
        // Snap to the live prompt FIRST (drops any queued wheel scroll before it can flush) so the
        // pasted text lands at the prompt instead of into copy-mode. xterm's native paste → onData
        // delivers the bytes right after.
        if (text) { snapToLive(); commitLine(firstLine(text)); }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (file.size > MAX_IMAGE_BYTES) { console.warn("[terminalhub] pasted image too large:", file.size); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        const imageBase64 = (typeof reader.result === "string" ? reader.result : "").split(",")[1];
        if (!imageBase64) return;
        try {
          const { insert } = await api.clipImage(workspaceId, terminalId, { imageBase64, mimeType: file.type });
          snapToLive(); // this insert bypasses onData, so snap to the live prompt here too
          send({ type: "input", data: shellQuote(insert) + " " });
        } catch (err) {
          console.warn("[terminalhub] image paste failed:", err);
        }
      };
      reader.readAsDataURL(file);
    };
    container.addEventListener("paste", onPaste, true);

    window.addEventListener("resize", scheduleResize);
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(container);

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      stopHeartbeat();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", wake);
      window.removeEventListener("resize", scheduleResize);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.removeEventListener("keydown", onModKey);
      window.removeEventListener("keyup", onModKey);
      window.removeEventListener("blur", onBlurClearMod);
      container.removeEventListener("mousemove", trackPointer);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      if (useUi.getState().focusedTerminalId === terminalId) useUi.getState().setFocusedTerminal(null);
      bellSub.dispose();
      osc9.dispose();
      osc777.dispose();
      linkProvider.dispose();
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel, true);
      if (scrollTimer) clearTimeout(scrollTimer);
      container.removeEventListener("paste", onPaste, true);
      ro.disconnect();
      ws?.close(); term.dispose();
    };
  }, [terminalId, container, workspaceId]);

  // Re-theme the live terminal when the active theme changes (the creation effect above keys only
  // on the terminal identity, so it doesn't tear down/recreate just to recolor).
  useEffect(() => { if (termRef.current) termRef.current.options.theme = xtheme; }, [xtheme]);

  // Apply an appearance change live without tearing the terminal down (the creation effect keys only
  // on identity, so it never recreates just to restyle). Font family/size/weight, line height, letter
  // spacing and padding all change the cell metrics, so refit + tell tmux to reflow; scrollback and
  // ligatures don't, but re-applying them here is cheap and idempotent.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = appearance.fontSize;
    term.options.fontFamily = appearance.fontFamily;
    term.options.fontWeight = appearance.fontWeight as Terminal["options"]["fontWeight"];
    term.options.lineHeight = appearance.lineHeight;
    term.options.letterSpacing = appearance.letterSpacing;
    term.options.scrollback = appearance.scrollback;
    if (container) {
      container.style.setProperty("--tr-term-pad", `${appearance.padding}px`);
      container.style.setProperty("--tr-term-pad-y", `${padY(appearance.padding)}px`);
      container.style.fontFeatureSettings = ligatureValue(appearance.ligatures);
    }
    if (container && container.clientWidth && container.clientHeight) fitRef.current?.fit();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  }, [appearance.fontSize, appearance.fontFamily, appearance.fontWeight, appearance.lineHeight,
      appearance.letterSpacing, appearance.padding, appearance.scrollback, appearance.ligatures, container]);

  const sendText = (text: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: text }));
    termRef.current?.focus();
  };

  // Right-click pane menu actions. getSelection feeds Copy and its disabled state. selectAll grabs the
  // VISIBLE grid only (tmux history isn't in xterm's buffer — that's what Copy All / the buffer viewer
  // are for). paste reads the browser clipboard and routes through xterm.paste so bracketed-paste mode
  // is honored (a multi-line paste into an agent TUI won't submit at the first newline) and the bytes
  // flow out via the same onData → socket path, which also snaps the pane back to the live prompt.
  const getSelection = () => termRef.current?.getSelection() ?? "";
  const selectAll = () => { termRef.current?.selectAll(); termRef.current?.focus(); };
  const paste = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) termRef.current?.paste(text);
    } catch { /* clipboard read blocked (no permission / non-secure context) — ignore */ }
    termRef.current?.focus();
  };

  // Right-click hit-test: the URL/path token at a viewport pixel, or null. Maps clientX/clientY to a
  // buffer cell off the live `.xterm-screen` metrics (its rect is exactly cols×rows cells), then runs
  // the same matcher the hover provider uses. Powers the menu's "Open Link" / "Copy Path".
  const linkAt = (clientX: number, clientY: number) => {
    const term = termRef.current;
    if (!term) return null;
    const screen = term.element?.querySelector(".xterm-screen") as HTMLElement | null;
    if (!screen) return null;
    const r = screen.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const col = Math.floor((clientX - r.left) / (r.width / term.cols));
    const row = Math.floor((clientY - r.top) / (r.height / term.rows));
    if (col < 0 || row < 0 || col >= term.cols || row >= term.rows) return null;
    return findLinkAt(term, term.buffer.active.viewportY + row + 1, col); // viewportY is 0-based; findLinkAt wants 1-based
  };
  const openLink = (hit: { kind: "url" | "path"; text: string }) => {
    if (hit.kind === "url") openUrlRef.current(hit.text);
    else openPathRef.current(hit.text);
  };
  // Find in scrollback. search() drives tmux copy-mode search server-side (full history, highlighted
  // in the pane); endSearch() snaps back to the live view by sending an empty input — the gateway,
  // parked in copy-mode by the search, cancels it on the next keystroke.
  const search = (query: string, direction: "up" | "down") => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "search", query, direction }));
  };
  const endSearch = () => sendText("");

  return { fit: () => fitRef.current?.fit(), sendText, focus: () => termRef.current?.focus(), getSelection, selectAll, paste, linkAt, openLink, search, endSearch };
}
