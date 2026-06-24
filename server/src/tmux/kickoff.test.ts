import { describe, it, expect, vi } from "vitest";
import { runKickoff } from "./kickoff.js";

/** Minimal fake: paneCommand returns each scripted value in turn (last value sticks); records the
 *  typed text and whether a separate Enter was sent to submit it. */
function fakeTmux(commands: string[]) {
  let i = 0;
  const typed: string[] = [];
  let entered = false;
  return {
    get typed() { return typed; },
    get entered() { return entered; },
    tmux: {
      async paneCommand() { const v = commands[Math.min(i, commands.length - 1)]; i++; return v; },
      async typeText(_name: string, text: string) { typed.push(text); },
      async sendEnter() { entered = true; },
    },
  };
}

const fast = { pollMs: 1, settleMs: 1, submitMs: 1, timeoutMs: 200 };

describe("runKickoff", () => {
  it("types the command then submits with a separate Enter once the pane is no longer a shell", async () => {
    const f = fakeTmux(["zsh", "zsh", "node"]);
    await runKickoff(f.tmux, "tr_x", "/loop 5m do thing", fast);
    expect(f.typed).toEqual(["/loop 5m do thing"]);
    expect(f.entered).toBe(true);
  });

  it("submits immediately when the agent is already the foreground command", async () => {
    const f = fakeTmux(["claude"]);
    await runKickoff(f.tmux, "tr_x", "/goal tests pass", fast);
    expect(f.typed).toEqual(["/goal tests pass"]);
    expect(f.entered).toBe(true);
  });

  it("never types into a bare shell — gives up if no agent launches before the timeout", async () => {
    const f = fakeTmux(["zsh"]); // stays a shell forever (e.g. claude not installed)
    await runKickoff(f.tmux, "tr_x", "/loop do thing", fast);
    expect(f.typed).toEqual([]);
    expect(f.entered).toBe(false);
  });
});
