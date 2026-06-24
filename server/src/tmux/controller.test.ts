import { describe, it, expect, vi } from "vitest";
import { createTmuxController, isNoTmuxServer } from "./controller.js";

function fakeRunner(responses: Record<string, string>) {
  const calls: string[][] = [];
  const run = vi.fn(async (args: string[]) => {
    calls.push(args);
    const key = args.join(" ");
    if (key in responses) return responses[key];
    return "";
  });
  return { run, calls };
}

describe("tmux controller", () => {
  it("creates a detached session in a folder, then arms bell monitoring", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.newSession("tr_ws_a_tm_b", "/work", 200, 50);
    // deep scrollback (10000) set globally FIRST — history-limit is read at pane creation, so it must
    // precede new-session for the new pane to inherit it
    expect(calls[0]).toEqual(["set-option","-g","history-limit","10000"]);
    expect(calls[1]).toEqual(["new-session","-d","-s","tr_ws_a_tm_b","-x","200","-y","50","-c","/work"]);
    expect(calls[2]).toEqual(["set-window-option","-t","tr_ws_a_tm_b","monitor-bell","on"]);
    // mouse OFF so a plain drag is a native, persistent xterm selection (not tmux's modal copy-mode)
    expect(calls[3]).toEqual(["set-option","-t","tr_ws_a_tm_b","mouse","off"]);
    // dark status bar (#141414) with Terminal Hub-green text, overriding tmux's default lime bg=green bar
    expect(calls[4]).toEqual(["set-option","-t","tr_ws_a_tm_b","status-style","bg=#141414,fg=#22c55e"]);
  });

  it("scroll up enters copy-mode (-e auto-exits at the bottom) then scrolls up N lines", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.scroll("tr_ws_a_tm_b", 5);
    expect(calls[0]).toEqual(["copy-mode","-e","-t","tr_ws_a_tm_b"]);
    expect(calls[1]).toEqual(["send-keys","-t","tr_ws_a_tm_b","-X","-N","5","scroll-up"]);
  });

  it("scroll down scrolls back toward the present without re-entering copy-mode", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.scroll("tr_ws_a_tm_b", -3);
    expect(calls[0]).toEqual(["send-keys","-t","tr_ws_a_tm_b","-X","-N","3","scroll-down"]);
  });

  it("scroll with 0 lines is a no-op", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.scroll("tr_ws_a_tm_b", 0);
    expect(calls).toEqual([]);
  });

  it("scroll swallows tmux's 'not in a mode' error (already at the bottom)", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.includes("scroll-down")) throw new Error("not in a mode");
      return "";
    });
    const tmux = createTmuxController(run);
    await expect(tmux.scroll("tr_ws_a_tm_b", -3)).resolves.toBeUndefined();
  });

  it("cancelCopyMode exits copy-mode so keystrokes reach the program again", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.cancelCopyMode("tr_ws_a_tm_b");
    expect(calls[0]).toEqual(["send-keys","-t","tr_ws_a_tm_b","-X","cancel"]);
  });

  it("cancelCopyMode swallows tmux's 'not in a mode' error (already live)", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.includes("cancel")) throw new Error("not in a mode");
      return "";
    });
    const tmux = createTmuxController(run);
    await expect(tmux.cancelCopyMode("tr_ws_a_tm_b")).resolves.toBeUndefined();
  });

  it("search up enters copy-mode then runs tmux's backward search for the query", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.search("tr_ws_a_tm_b", "needle", "up");
    expect(calls[0]).toEqual(["copy-mode","-e","-t","tr_ws_a_tm_b"]);
    expect(calls[1]).toEqual(["send-keys","-t","tr_ws_a_tm_b","-X","search-backward","needle"]);
  });

  it("search down runs the forward search (toward the present)", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.search("tr_ws_a_tm_b", "needle", "down");
    expect(calls[1]).toEqual(["send-keys","-t","tr_ws_a_tm_b","-X","search-forward","needle"]);
  });

  it("search passes the query literally (spaces/quotes are not shell-interpreted)", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.search("tr_ws_a_tm_b", 'foo "bar" baz', "up");
    expect(calls[1]).toEqual(["send-keys","-t","tr_ws_a_tm_b","-X","search-backward",'foo "bar" baz']);
  });

  it("search with an empty query is a no-op", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.search("tr_ws_a_tm_b", "", "up");
    expect(calls).toEqual([]);
  });

  it("search swallows a tmux error (session gone / not in a mode)", async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.includes("search-backward")) throw new Error("no such session");
      return "";
    });
    const tmux = createTmuxController(run);
    await expect(tmux.search("tr_ws_a_tm_b", "needle", "up")).resolves.toBeUndefined();
  });

  it("clearHistory wipes the pane's scrollback", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.clearHistory("tr_ws_a_tm_b");
    expect(calls[0]).toEqual(["clear-history","-t","tr_ws_a_tm_b"]);
  });

  it("clearHistory swallows a tmux error (session gone)", async () => {
    const run = vi.fn(async () => { throw new Error("no such session"); });
    const tmux = createTmuxController(run);
    await expect(tmux.clearHistory("tr_ws_a_tm_b")).resolves.toBeUndefined();
  });

  it("setMonitorBell turns the option on for a session", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.setMonitorBell("tr_ws_a_tm_b");
    expect(calls[0]).toEqual(["set-window-option","-t","tr_ws_a_tm_b","monitor-bell","on"]);
  });

  it("setMonitorSilence sets the silence interval (0 = off) for a session", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.setMonitorSilence("tr_ws_a_tm_b", 10);
    expect(calls[0]).toEqual(["set-window-option","-t","tr_ws_a_tm_b","monitor-silence","10"]);
    await tmux.setMonitorSilence("tr_ws_a_tm_b", 0);
    expect(calls[1]).toEqual(["set-window-option","-t","tr_ws_a_tm_b","monitor-silence","0"]);
  });

  it("setMonitorSilenceAll applies the interval to every Terminal Hub session", async () => {
    const { run, calls } = fakeRunner({
      "list-sessions -F #{session_name}": "tr_ws_a_tm_b\nother\ntr_ws_c_tm_d\n",
    });
    const tmux = createTmuxController(run);
    await tmux.setMonitorSilenceAll(8);
    const sets = calls.filter(c => c[0] === "set-window-option" && c.includes("monitor-silence"));
    expect(sets).toEqual([
      ["set-window-option","-t","tr_ws_a_tm_b","monitor-silence","8"],
      ["set-window-option","-t","tr_ws_c_tm_d","monitor-silence","8"],
    ]);
  });

  it("windowFlags maps Terminal Hub sessions to their bell + silence flags, ignoring foreign sessions", async () => {
    const { run } = fakeRunner({
      "list-windows -a -F #{session_name} #{window_bell_flag} #{window_silence_flag}":
        "tr_ws_a_tm_b 1 0\nother 1 1\ntr_ws_c_tm_d 0 1\n",
    });
    const tmux = createTmuxController(run);
    const flags = await tmux.windowFlags();
    expect(flags.get("tr_ws_a_tm_b")).toEqual({ bell: true, silence: false });
    expect(flags.get("tr_ws_c_tm_d")).toEqual({ bell: false, silence: true });
    expect(flags.has("other")).toBe(false);
  });

  it("capturePane prints the visible pane as plain text", async () => {
    const { run, calls } = fakeRunner({ "capture-pane -p -t tr_ws_a_tm_b": "line1\nline2\n" });
    const tmux = createTmuxController(run);
    const out = await tmux.capturePane("tr_ws_a_tm_b");
    expect(out).toBe("line1\nline2\n");
    expect(calls).toContainEqual(["capture-pane", "-p", "-t", "tr_ws_a_tm_b"]);
  });

  it("capturePreview prints the visible pane WITH ANSI colors preserved (for the stage-manager thumbnail)", async () => {
    const { run, calls } = fakeRunner({ "capture-pane -e -p -t tr_ws_a_tm_b": "\x1b[32mok\x1b[0m\n" });
    const tmux = createTmuxController(run);
    const out = await tmux.capturePreview("tr_ws_a_tm_b");
    expect(out).toBe("\x1b[32mok\x1b[0m\n");
    expect(calls).toContainEqual(["capture-pane", "-e", "-p", "-t", "tr_ws_a_tm_b"]);
  });

  it("captureScrollback grabs the whole history (joined lines), top of history to bottom of pane", async () => {
    const { run, calls } = fakeRunner({ "capture-pane -p -J -t tr_ws_a_tm_b -S - -E -": "old\nnew\n" });
    const tmux = createTmuxController(run);
    const out = await tmux.captureScrollback("tr_ws_a_tm_b");
    expect(out).toBe("old\nnew\n");
    expect(calls).toContainEqual(["capture-pane", "-p", "-J", "-t", "tr_ws_a_tm_b", "-S", "-", "-E", "-"]);
  });

  it("captureScrollback caps to the last N lines when given a positive count", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.captureScrollback("tr_ws_a_tm_b", 500);
    expect(calls).toContainEqual(["capture-pane", "-p", "-J", "-t", "tr_ws_a_tm_b", "-S", "-500", "-E", "-"]);
  });

  it("sends a launch command + Enter", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.sendKeys("tr_ws_a_tm_b", "claude");
    expect(calls[0]).toEqual(["send-keys","-t","tr_ws_a_tm_b","claude","Enter"]);
  });

  it("kills a session", async () => {
    const { run, calls } = fakeRunner({});
    const tmux = createTmuxController(run);
    await tmux.killSession("tr_ws_a_tm_b");
    expect(calls[0]).toEqual(["kill-session","-t","tr_ws_a_tm_b"]);
  });

  it("lists only Terminal Hub sessions", async () => {
    const { run } = fakeRunner({ "list-sessions -F #{session_name}": "tr_ws_a_tm_b\nother\ntr_ws_c_tm_d\n" });
    const tmux = createTmuxController(run);
    expect(await tmux.listSessions()).toEqual(["tr_ws_a_tm_b","tr_ws_c_tm_d"]);
  });

  it("hasSession is true when listed", async () => {
    const { run } = fakeRunner({ "list-sessions -F #{session_name}": "tr_ws_a_tm_b\n" });
    const tmux = createTmuxController(run);
    expect(await tmux.hasSession("tr_ws_a_tm_b")).toBe(true);
    expect(await tmux.hasSession("tr_ws_z_tm_z")).toBe(false);
  });

  it("panePid returns the first pane's pid as a number", async () => {
    const { run, calls } = fakeRunner({ "list-panes -t tr_ws_a_tm_b -F #{pane_pid}": "12345\n" });
    const tmux = createTmuxController(run);
    expect(await tmux.panePid("tr_ws_a_tm_b")).toBe(12345);
    expect(calls[0]).toEqual(["list-panes","-t","tr_ws_a_tm_b","-F","#{pane_pid}"]);
  });

  it("panePid returns undefined when the session has no panes", async () => {
    const { run } = fakeRunner({});
    const tmux = createTmuxController(run);
    expect(await tmux.panePid("tr_ws_gone_tm_x")).toBeUndefined();
  });

  it("scrubGlobalEnv unsets only the hub/PM2 vars from the global env, leaving real ones", async () => {
    const { run, calls } = fakeRunner({
      "show-environment -g":
        "PATH=/usr/bin\nHOME=/Users/me\nPORT=5173\nNODE_ENV=production\n" +
        "TERMINALHUB_TOKEN=secret\npm_id=0\nname=terminalhub\nSSH_AUTH_SOCK=/tmp/ssh\n",
    });
    const tmux = createTmuxController(run);
    const removed = await tmux.scrubGlobalEnv();
    expect(removed.sort()).toEqual(["NODE_ENV","PORT","TERMINALHUB_TOKEN","name","pm_id"].sort());
    const unsets = calls.filter(c => c[0] === "set-environment").map(c => c[3]);
    expect(unsets.sort()).toEqual(["NODE_ENV","PORT","TERMINALHUB_TOKEN","name","pm_id"].sort());
    // never touches PATH / HOME / SSH_AUTH_SOCK
    expect(unsets).not.toContain("PATH");
    expect(unsets).not.toContain("SSH_AUTH_SOCK");
  });

  it("scrubGlobalEnv is a no-op when no tmux server is running", async () => {
    const { run, calls } = fakeRunner({}); // show-environment returns "" (isNoTmuxServer swallows)
    const tmux = createTmuxController(run);
    expect(await tmux.scrubGlobalEnv()).toEqual([]);
    expect(calls.some(c => c[0] === "set-environment")).toBe(false);
  });

  it("scrubGlobalEnv ignores already-removed (-VAR) lines", async () => {
    const { run, calls } = fakeRunner({ "show-environment -g": "-PORT\nPATH=/usr/bin\n" });
    const tmux = createTmuxController(run);
    expect(await tmux.scrubGlobalEnv()).toEqual([]);
    expect(calls.some(c => c[0] === "set-environment")).toBe(false);
  });
});

describe("isNoTmuxServer", () => {
  it("treats a running-but-sessionless server message as empty", () => {
    expect(isNoTmuxServer("no server running on /tmp/tmux-0/default")).toBe(true);
  });

  it("treats a missing socket (fresh boot, tmux never started) as empty", () => {
    expect(isNoTmuxServer("error connecting to /tmp/tmux-0/default (No such file or directory)")).toBe(true);
  });

  it("does not swallow a real error such as a bad working directory", () => {
    expect(isNoTmuxServer("/no/such/dir: No such file or directory")).toBe(false);
  });
});
