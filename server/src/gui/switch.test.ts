import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Terminal, TerminalMode } from "../types.js";
import type { TmuxController } from "../tmux/controller.js";
import { projectPathToFolderName } from "../claude/paths.js";
import { sessionLinkFromLaunch } from "../claude/terminalLink.js";
import { switchToGui, switchToTmux, SwitchBlocked, resumeCommand, type SwitchDeps } from "./switch.js";

const FOLDER = "/work/switchproj";
const SESSION_ID = "aaaabbbb-1111-2222-3333-444455556666";
const TMUX = "tr_ws_1_tm_1";

let home: string;
let realHome: string | undefined;

function projectDir(): string {
  return path.join(home, ".claude", "projects", projectPathToFolderName(FOLDER));
}

/** Write a transcript for SESSION_ID so computeSessionState has something real to classify. */
function writeTranscript(lines: object[]): void {
  mkdirSync(projectDir(), { recursive: true });
  writeFileSync(path.join(projectDir(), `${SESSION_ID}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

function terminal(over: Partial<Terminal> = {}): Terminal {
  return {
    id: "tm_1",
    workspaceId: "ws_1",
    title: "T1",
    color: null,
    icon: null,
    tmuxSession: TMUX,
    launchCommandOverride: null,
    position: 0,
    createdAt: 0,
    titleAuto: true,
    systemPrompt: null,
    mode: "tmux",
    agentSessionId: null,
    ...over,
  };
}

interface Call { fn: string; args: unknown[]; }

/** SwitchDeps whose every side effect lands in one ordered list, so tests can assert ordering
 *  across tmux writes and persistence — not just that each happened. */
function makeDeps(over: { panePid?: number } = {}) {
  const calls: Call[] = [];
  const record = (fn: string, ...args: unknown[]) => { calls.push({ fn, args }); };
  const tmux = {
    sendKey: async (name: string, key: string) => { record("sendKey", name, key); },
    sendKeys: async (name: string, text: string) => { record("sendKeys", name, text); },
    typeText: async (name: string, text: string) => { record("typeText", name, text); },
    sendEnter: async (name: string) => { record("sendEnter", name); },
    panePid: async (name: string) => { record("panePid", name); return over.panePid; },
  } as unknown as TmuxController;

  const deps: SwitchDeps = {
    tmux,
    stopGui: async (terminalId) => { record("stopGui", terminalId); },
    setMode: (terminalId, mode: TerminalMode) => { record("setMode", terminalId, mode); },
    setAgentSession: (terminalId, sessionId) => { record("setAgentSession", terminalId, sessionId); },
  };
  return { deps, calls, names: () => calls.map((c) => c.fn) };
}

const keysSent = (calls: Call[]) => calls.filter((c) => c.fn === "sendKey").map((c) => c.args);

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-gui-switch-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

describe("switchToGui", () => {
  it("persists the session, flips the mode, and quits the pane's agent with bare keys", async () => {
    const { deps, calls, names } = makeDeps();
    const term = terminal({ launchCommandOverride: resumeCommand(SESSION_ID) });

    expect(await switchToGui(term, FOLDER, deps)).toEqual({ mode: "gui", sessionId: SESSION_ID });

    // C-c C-c C-d, in that order, each as a bare key — sendKeys would append an Enter, turning the
    // first Ctrl-C into "cancel, then submit".
    expect(keysSent(calls)).toEqual([[TMUX, "C-c"], [TMUX, "C-c"], [TMUX, "C-d"]]);
    expect(calls.some((c) => c.fn === "sendKeys")).toBe(false);
    expect(names()).toEqual(["sendKey", "sendKey", "sendKey", "setAgentSession", "setMode"]);
    expect(calls.find((c) => c.fn === "setAgentSession")!.args).toEqual(["tm_1", SESSION_ID]);
    expect(calls.find((c) => c.fn === "setMode")!.args).toEqual(["tm_1", "gui"]);
  });

  it("allows the switch when the session's transcript shows an idle agent", async () => {
    writeTranscript([
      { type: "user", message: { role: "user", content: "do it" }, timestamp: new Date().toISOString() },
      { type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: [] }, timestamp: new Date().toISOString() },
    ]);
    const { deps, calls } = makeDeps();

    expect(await switchToGui(terminal({ launchCommandOverride: resumeCommand(SESSION_ID) }), FOLDER, deps))
      .toEqual({ mode: "gui", sessionId: SESSION_ID });
    expect(keysSent(calls)).toHaveLength(3);
  });

  it("refuses and changes nothing while the agent is mid-turn", async () => {
    // A fresh user turn with no answer yet is exactly what computeSessionState calls "active".
    writeTranscript([
      { type: "assistant", message: { role: "assistant", stop_reason: "end_turn", content: [] }, timestamp: new Date(Date.now() - 5_000).toISOString() },
      { type: "user", message: { role: "user", content: "keep going" }, timestamp: new Date().toISOString() },
    ]);
    const { deps, calls } = makeDeps();
    const term = terminal({ launchCommandOverride: resumeCommand(SESSION_ID) });

    await expect(switchToGui(term, FOLDER, deps)).rejects.toBeInstanceOf(SwitchBlocked);
    await expect(switchToGui(term, FOLDER, deps)).rejects.toThrow(/still working/i);

    // no keys into the pane, no mode write, no session write
    expect(calls.filter((c) => c.fn !== "panePid")).toEqual([]);
  });

  it("sends no quit keys when the pane has no agent running", async () => {
    // A stray C-d would EOF the pane's shell and close it — the one thing the handoff must not do.
    const { deps, calls, names } = makeDeps({ panePid: undefined });

    expect(await switchToGui(terminal({ launchCommandOverride: "claude" }), FOLDER, deps))
      .toEqual({ mode: "gui", sessionId: null });

    expect(keysSent(calls)).toEqual([]);
    expect(names()).toEqual(["panePid", "setAgentSession", "setMode"]);
    expect(calls.find((c) => c.fn === "setAgentSession")!.args).toEqual(["tm_1", null]);
    expect(calls.find((c) => c.fn === "setMode")!.args).toEqual(["tm_1", "gui"]);
  });

  it("quits the pane but records no session id for a non-Claude agent", async () => {
    const { deps, calls } = makeDeps();
    const term = terminal({ launchCommandOverride: "codex resume 01ABCDEF" });

    expect(await switchToGui(term, FOLDER, deps)).toEqual({ mode: "gui", sessionId: null });
    // something IS running in the pane, so it still gets quit — there's just no Claude session to carry over
    expect(keysSent(calls)).toEqual([[TMUX, "C-c"], [TMUX, "C-c"], [TMUX, "C-d"]]);
    expect(calls.find((c) => c.fn === "setAgentSession")!.args).toEqual(["tm_1", null]);
  });
});

describe("switchToTmux", () => {
  it("stops the GUI agent before typing the resume command back into the pane", async () => {
    const { deps, calls, names } = makeDeps();
    const term = terminal({ mode: "gui", agentSessionId: SESSION_ID });

    expect(await switchToTmux(term, "claude", deps)).toEqual({ mode: "tmux", sessionId: SESSION_ID });

    // Ordering is the contract: two live processes on one session id would corrupt the transcript.
    expect(names()).toEqual(["stopGui", "sendKeys", "setMode"]);
    expect(calls[0].args).toEqual(["tm_1"]);
    expect(calls[1].args).toEqual([TMUX, resumeCommand(SESSION_ID)]);
    expect(calls[2].args).toEqual(["tm_1", "tmux"]);
  });

  it("launches fresh when the terminal never got a session id", async () => {
    const { deps, calls, names } = makeDeps();

    expect(await switchToTmux(terminal({ mode: "gui", agentSessionId: null }), "claude", deps))
      .toEqual({ mode: "tmux", sessionId: null });
    // Nothing to resume, so the pane gets the workspace's launch command rather than a bare shell.
    expect(names()).toEqual(["stopGui", "sendKeys", "setMode"]);
    expect(calls[1].args).toEqual([TMUX, "claude"]);
  });

  it("sends no command when there is neither a session id nor a launch command", async () => {
    const { deps, calls, names } = makeDeps();

    await switchToTmux(terminal({ mode: "gui", agentSessionId: null }), "   ", deps);
    expect(names()).toEqual(["stopGui", "setMode"]);
    expect(calls.some((c) => c.fn === "sendKeys")).toBe(false);
  });
});

describe("resumeCommand", () => {
  it("stays parseable by sessionLinkFromLaunch — that link is what re-binds the pane", () => {
    expect(sessionLinkFromLaunch(resumeCommand(SESSION_ID))).toEqual({ agent: "claude", sessionId: SESSION_ID });
  });

  it("round-trips through a switch back to gui", async () => {
    const { deps } = makeDeps();
    // A pane launched by switchToTmux carries resumeCommand as its launch line; switching back to
    // GUI must recover the same session id from it.
    const relaunched = terminal({ launchCommandOverride: resumeCommand(SESSION_ID) });
    expect((await switchToGui(relaunched, FOLDER, deps)).sessionId).toBe(SESSION_ID);
  });

  it("carries the model flag and the session id verbatim", () => {
    const cmd = resumeCommand(SESSION_ID);
    expect(cmd).toContain("--resume");
    expect(cmd.endsWith(SESSION_ID)).toBe(true);
    expect(cmd.startsWith("claude ")).toBe(true);
  });
});
