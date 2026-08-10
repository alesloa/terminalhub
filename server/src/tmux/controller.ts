import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isTerminalHubSession } from "./names.js";
import { cleanShellEnv, shouldDropEnvKey } from "./cleanEnv.js";

const pexec = promisify(execFile);

/** tmux status bar style: a dark #141414 bar with the given foreground (status text) color, overriding
 *  tmux's loud default (`bg=green,fg=black` — the lime bar). The whole bar inherits this (left/window/
 *  right styles stay `default`). `fg` is the user's chosen status-text color (Settings → Appearance),
 *  defaulting to Terminal Hub green. Shared by newSession and the gateway's on-attach enforcement. */
export function tmuxStatusStyle(fg: string = "#22c55e"): string {
  return `bg=#141414,fg=${fg}`;
}
/** The default status style (green text). Kept for callers that don't override the color. */
export const TMUX_STATUS_STYLE = tmuxStatusStyle();

/** Runner abstraction so tests can inject a fake. Returns stdout. */
export type TmuxRunner = (args: string[]) => Promise<string>;

/**
 * True when tmux's stderr means "there's no server/sessions to talk to" rather than
 * a real failure. For our list/no-op commands that's an empty result, not a crash.
 * A fresh box (tmux never started) has no socket file yet, so tmux reports
 * "error connecting to <socket> (No such file or directory)" instead of
 * "no server running" — both must be treated the same.
 */
export function isNoTmuxServer(stderr: string): boolean {
  return /no server running|no sessions|error connecting to /i.test(stderr);
}

export const realRunner: TmuxRunner = async (args) => {
  try {
    // 16MB headroom: most commands return a few bytes, but captureScrollback can dump the full
    // history (history-limit 10000 × wide rows). Only raises the ceiling — small outputs unaffected.
    // env: cleanShellEnv() so the command that STARTS the tmux server bakes a clean global
    // environment — no PORT / NODE_ENV / TERMINALHUB_* / PM2 junk leaking into pane shells.
    const { stdout } = await pexec("tmux", args, { maxBuffer: 16 * 1024 * 1024, env: cleanShellEnv() });
    return stdout;
  } catch (err: any) {
    if (typeof err?.stderr === "string" && isNoTmuxServer(err.stderr)) return "";
    throw err;
  }
};

/** A session window's unviewed alert flags, as tmux reports them. `bell` = an agent rang `\a`;
 *  `silence` = the pane went quiet for the armed monitor-silence interval. Both clear on view. */
export interface WindowFlags { bell: boolean; silence: boolean; }

export interface TmuxController {
  newSession(name: string, folder: string, cols: number, rows: number): Promise<void>;
  sendKeys(name: string, text: string): Promise<void>;
  /** Type a string literally into the pane WITHOUT a trailing Enter (`send-keys -l`). Pair with
   *  sendEnter to submit it as a separate keypress — some TUIs (Claude Code) treat a CR that arrives
   *  in the same burst as the text as a soft-newline instead of "submit". */
  typeText(name: string, text: string): Promise<void>;
  /** Send a lone Enter (CR) keypress — the submit key for shells and Claude Code's TUI. */
  sendEnter(name: string): Promise<void>;
  /** Send one tmux key name (`C-c`, `C-d`, `Escape`, …) with NO trailing Enter. sendKeys would
   *  append a CR, which turns a bare Ctrl-C into Ctrl-C-then-submit. */
  sendKey(name: string, key: string): Promise<void>;
  killSession(name: string): Promise<void>;
  listSessions(): Promise<string[]>;
  hasSession(name: string): Promise<boolean>;
  setMonitorBell(name: string): Promise<void>;
  /** Arm (seconds > 0) or disable (0) tmux silence monitoring for a session — sets window_silence_flag
   *  after `seconds` of no pane output. Used by the silence/layered attention modes. */
  setMonitorSilence(name: string, seconds: number): Promise<void>;
  /** Apply a silence interval (0 = off) to EVERY live Terminal Hub session at once, so changing the
   *  attention mode / quiet window in Settings re-arms all open terminals immediately. */
  setMonitorSilenceAll(seconds: number): Promise<void>;
  /** Map of Terminal Hub session name -> its unviewed bell + silence flags (needs attention). */
  windowFlags(): Promise<Map<string, WindowFlags>>;
  /** The shell pid of a session's (first) pane, or undefined if the session is gone. */
  panePid(name: string): Promise<number | undefined>;
  /** The active pane's current working directory (honours `cd`), or "" if unavailable. */
  paneCwd(name: string): Promise<string>;
  /** The active pane's foreground command (e.g. "zsh" at the shell, "node"/"claude" once an agent
   *  is running). "" if the session is gone. Used to know when an auto-launched CLI is actually up. */
  paneCommand(name: string): Promise<string>;
  /** The visible pane content as plain text (`capture-pane -p`). "" if the session is gone. Used to
   *  detect when an agent is actively working — its spinner/timer makes the text change between
   *  samples (see ../activity/working.ts). */
  capturePane(name: string): Promise<string>;
  /** The visible pane content WITH ANSI/SGR escapes preserved (`capture-pane -e -p`) — a colored
   *  "thumbnail" of the current screen for the Stage Manager dock. "" if the session is gone. Kept
   *  separate from capturePane (plain text, used by the working sampler) so that stays unaffected. */
  capturePreview(name: string): Promise<string>;
  /** Full scrollback (history + current screen) as plain text, wrapped lines joined. `lines` caps to
   *  the last N history lines; omitted = the entire buffer. Backs the buffer viewer / copy-all — kept
   *  separate from capturePane (visible-only) so the agent-working sampler is unaffected. */
  captureScrollback(name: string, lines?: number): Promise<string>;
  /** Scroll the pane via copy-mode: +lines = back into history, -lines = toward the present. */
  scroll(name: string, lines: number): Promise<void>;
  /** Exit copy-mode back to the live view so keystrokes reach the program again. */
  cancelCopyMode(name: string): Promise<void>;
  /** Find in the pane's FULL scrollback via tmux's own copy-mode search, jumping to the nearest
   *  match (up = backward into history, down = forward toward the present) and highlighting it in the
   *  live pane. Leaves the pane parked in copy-mode; the next keystroke (or cancelCopyMode) snaps back
   *  to live. Re-issuing the same query in the same direction steps to the next match. */
  search(name: string, query: string, direction: "up" | "down"): Promise<void>;
  /** Wipe the pane's scrollback history (`clear-history`). The live screen is untouched. Irreversible. */
  clearHistory(name: string): Promise<void>;
  /** Set one session's tmux status-bar style (e.g. recolor its text). Used to apply a status-color
   *  change to a single session; the on-attach enforcement (terminalGateway) does the same per open. */
  setStatusStyle(name: string, style: string): Promise<void>;
  /** Apply a status-bar style to EVERY live Terminal Hub session at once (listSessions already filters
   *  to ours), so changing the status-text color in Settings recolors all open terminals immediately. */
  setStatusStyleAll(style: string): Promise<void>;
  /** Remove hub/PM2-injected vars (PORT, NODE_ENV, TERMINALHUB_*, pm_*, …) from the tmux server's
   *  GLOBAL environment, so sessions created afterwards don't copy them. Fixes an already-running
   *  server whose global env was captured before the clean-env spawn fix. Returns the keys removed.
   *  Existing panes keep their environment until recreated — tmux can't retro-edit a live shell. */
  scrubGlobalEnv(): Promise<string[]>;
}

export function createTmuxController(run: TmuxRunner = realRunner): TmuxController {
  return {
    async newSession(name, folder, cols, rows) {
      // Deep scrollback for the buffer viewer / copy-all. history-limit is read only when a pane is
      // CREATED, so it must be in effect BEFORE new-session — and there's no per-new-session flag for
      // it, so set the server global first; the new session's pane inherits it. (tmux default is 2000.)
      await run(["set-option","-g","history-limit","10000"]);
      await run(["new-session","-d","-s",name,"-x",String(cols),"-y",String(rows),"-c",folder]);
      // Record bells even while detached, so a backgrounded agent's "needs attention"
      // beep is visible later. Default is on, but force it in case the user's config disabled it.
      await this.setMonitorBell(name);
      // Mouse mode OFF so a plain click-drag is a real, persistent xterm.js selection (the
      // highlight stays put; Cmd/Ctrl-C and copy-on-select work) — exactly like a regular terminal.
      // With mouse on, tmux instead captures the drag into its modal copy-mode (the "weird yellow"
      // selection that freezes the pane and can't stay highlighted). The cost — the wheel no longer
      // drives tmux scrollback — is bridged from the browser via {type:"scroll"} (terminalGateway →
      // scroll()). Forced off per session because the user's ~/.tmux.conf may enable it globally.
      // Also enforced on attach (terminalGateway) for sessions created before this.
      await run(["set-option","-t",name,"mouse","off"]);
      // Recolor tmux's status bar from its loud default lime (bg=green) to a dark bar. Also
      // re-asserted on attach (terminalGateway) for sessions created before this.
      await run(["set-option","-t",name,"status-style",TMUX_STATUS_STYLE]);
    },
    async sendKeys(name, text) {
      await run(["send-keys","-t",name,text,"Enter"]);
    },
    async typeText(name, text) {
      // `-l` sends the argument literally (no tmux key-name lookup), so a prompt containing words like
      // "Enter"/"Space" or punctuation is typed verbatim. No trailing Enter — submit via sendEnter.
      await run(["send-keys","-t",name,"-l",text]);
    },
    async sendEnter(name) {
      await run(["send-keys","-t",name,"Enter"]);
    },
    async sendKey(name, key) {
      await run(["send-keys","-t",name,key]);
    },
    async killSession(name) {
      await run(["kill-session","-t",name]);
    },
    async listSessions() {
      const out = await run(["list-sessions","-F","#{session_name}"]);
      return out.split("\n").map(s => s.trim()).filter(s => s && isTerminalHubSession(s));
    },
    async hasSession(name) {
      return (await this.listSessions()).includes(name);
    },
    async setMonitorBell(name) {
      await run(["set-window-option","-t",name,"monitor-bell","on"]);
    },
    async setMonitorSilence(name, seconds) {
      await run(["set-window-option","-t",name,"monitor-silence",String(seconds)]);
    },
    async setMonitorSilenceAll(seconds) {
      for (const s of await this.listSessions()) {
        try { await this.setMonitorSilence(s, seconds); } catch { /* session vanished mid-sweep */ }
      }
    },
    async windowFlags() {
      // One window per session; the bell flag is set when a bell fires with no client viewing it, and
      // the silence flag when the pane is quiet for the armed monitor-silence window. Both clear
      // automatically when our PTY attaches (you open the tab) — so this only sees CLOSED rooms.
      const out = await run(["list-windows","-a","-F","#{session_name} #{window_bell_flag} #{window_silence_flag}"]);
      const map = new Map<string, WindowFlags>();
      for (const line of out.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 3) continue;
        const [name, bell, silence] = parts;
        if (isTerminalHubSession(name)) map.set(name, { bell: bell === "1", silence: silence === "1" });
      }
      return map;
    },
    async panePid(name) {
      const out = await run(["list-panes","-t",name,"-F","#{pane_pid}"]);
      const first = out.split("\n").map(s => s.trim()).find(Boolean);
      const pid = first ? Number(first) : NaN;
      return Number.isFinite(pid) && pid > 0 ? pid : undefined;
    },
    async paneCwd(name) {
      // display-message takes the format as its trailing message arg (not -F). Empty string when
      // the session is gone (isNoTmuxServer swallows that to "") so callers can fall back.
      const out = await run(["display-message","-p","-t",name,"#{pane_current_path}"]);
      return out.split("\n").map(s => s.trim()).find(Boolean) ?? "";
    },
    async paneCommand(name) {
      const out = await run(["display-message","-p","-t",name,"#{pane_current_command}"]);
      return out.split("\n").map(s => s.trim()).find(Boolean) ?? "";
    },
    async capturePane(name) {
      // -p prints to stdout; the default target is the visible pane (no -S, so scrollback is
      // excluded — a static idle screen captures identically each time). isNoTmuxServer swallows a
      // vanished session to "".
      return await run(["capture-pane", "-p", "-t", name]);
    },
    async capturePreview(name) {
      // -e keeps ANSI/SGR so the dock preview is colored; -p prints the VISIBLE pane (current
      // screen = a live thumbnail). No -S, so scrollback is excluded. isNoTmuxServer swallows a
      // vanished session to "".
      return await run(["capture-pane", "-e", "-p", "-t", name]);
    },
    async captureScrollback(name, lines) {
      // -p print to stdout, -J join wrapped lines into one logical line. -S start / -E end:
      //   -S - = top of history (or -<N> = N lines back, when capped); -E - = bottom of the pane.
      // So the default grabs the entire history + the live screen. isNoTmuxServer swallows a vanished
      // session to "".
      const start = lines && lines > 0 ? `-${lines}` : "-";
      return await run(["capture-pane", "-p", "-J", "-t", name, "-S", start, "-E", "-"]);
    },
    async scroll(name, lines) {
      // Mouse mode is off (see newSession), so the browser bridges the wheel here. Scrolling up
      // enters copy-mode with -e (which auto-exits once the user scrolls back to the bottom);
      // scrolling down just moves toward the present. send-keys -X scroll-down outside copy-mode
      // errors with "not in a mode" — swallow that (and a session vanishing mid-scroll): both are
      // harmless "already at the present" races, not failures worth surfacing.
      try {
        if (lines > 0) {
          await run(["copy-mode","-e","-t",name]);
          await run(["send-keys","-t",name,"-X","-N",String(lines),"scroll-up"]);
        } else if (lines < 0) {
          await run(["send-keys","-t",name,"-X","-N",String(-lines),"scroll-down"]);
        }
      } catch { /* "not in a mode" at the bottom, or the session is gone — ignore */ }
    },
    async cancelCopyMode(name) {
      // Scrolling up parks the pane in copy-mode (see scroll), which swallows keystrokes instead of
      // passing them to the program. The gateway calls this on the first input after a scroll so a
      // keypress snaps back to the live view (iTerm/Terminal.app behaviour) and reaches the app.
      // `-X cancel` errors "not in a mode" when already live (or the session vanished) — swallow it.
      try { await run(["send-keys","-t",name,"-X","cancel"]); } catch { /* already live — ignore */ }
    },
    async search(name, query, direction) {
      // Enter copy-mode (-e auto-exits once scrolled back to the bottom) and run tmux's own search,
      // which scans the WHOLE history — not just the visible grid the browser holds. tmux jumps the
      // cursor to the nearest match from the current position, so re-issuing the same query/direction
      // steps to the next one. The query rides through execFile as a literal arg (no shell), so spaces
      // and quotes are searched verbatim. "not in a mode" / a vanished session → harmless, swallow it.
      if (!query) return;
      try {
        await run(["copy-mode","-e","-t",name]);
        await run(["send-keys","-t",name,"-X",direction === "up" ? "search-backward" : "search-forward",query]);
      } catch { /* session gone — ignore */ }
    },
    async clearHistory(name) {
      // Drops the off-screen scrollback only; the visible pane is untouched (that's Ctrl+L's job).
      try { await run(["clear-history","-t",name]); } catch { /* session gone — nothing to clear */ }
    },
    async setStatusStyle(name, style) {
      try { await run(["set-option","-t",name,"status-style",style]); } catch { /* session gone */ }
    },
    async setStatusStyleAll(style) {
      for (const name of await this.listSessions()) await this.setStatusStyle(name, style);
    },
    async scrubGlobalEnv() {
      // Read the server's global environment and unset every key our denylist flags. show-environment
      // prints one `KEY=value` per line (or `-KEY` for a var explicitly removed in this scope). No
      // server yet → isNoTmuxServer swallows the error to "" → nothing to scrub.
      let out = "";
      try { out = await run(["show-environment","-g"]); } catch { return []; }
      const removed: string[] = [];
      for (const line of out.split("\n")) {
        const l = line.trim();
        if (!l || l.startsWith("-")) continue;
        const eq = l.indexOf("=");
        const key = eq === -1 ? l : l.slice(0, eq);
        if (key && shouldDropEnvKey(key)) {
          try { await run(["set-environment","-g","-u",key]); removed.push(key); }
          catch { /* server vanished mid-scrub — nothing to do */ }
        }
      }
      return removed;
    },
  };
}
