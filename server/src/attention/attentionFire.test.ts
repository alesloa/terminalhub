import { describe, it, expect, vi } from "vitest";
import { createAttentionFirer } from "./attentionFire.js";
import type { CustomAgent, Terminal, Workspace } from "../types.js";

const term = (over: Partial<Terminal> = {}): Terminal => ({
  id: "tm_1", workspaceId: "ws_1", title: "Claude - SEO", color: null, icon: null,
  tmuxSession: "tr_ws_1_tm_1", launchCommandOverride: null, position: 0, createdAt: 0, titleAuto: true,
  ...over,
});
const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: "ws_1", name: "client-apps", folder: "/x", launchCommand: "claude", color: null, cardColor: null,
  layout: null, spaceId: null, config: null, x: 0, y: 0, createdAt: 0, updatedAt: 0, ...over,
});

function setup(now: () => number, opts: { term?: Terminal; ws?: Workspace; customAgents?: CustomAgent[] } = {}) {
  const fire = vi.fn(() => "pn_1");
  const t = opts.term ?? term();
  const w = opts.ws ?? ws();
  const store = {
    getTerminal: (id: string) => (id === t.id ? t : undefined),
    getWorkspace: (id: string) => (id === w.id ? w : undefined),
    listCustomAgents: () => opts.customAgents ?? [],
  };
  const firer = createAttentionFirer({ store, pending: { fire }, cooldownMs: 4000, now });
  return { firer, fire };
}

describe("attentionFire", () => {
  it("fires a needs-attention notification with the terminal's title + workspace name", () => {
    const { firer, fire } = setup(() => 1000);
    expect(firer.fire("tm_1")).toBe(true);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({
      title: "Claude - SEO",
      text: "needs attention · client-apps",
      source: "attention",
      category: "agent",
      workspaceId: "ws_1",
      terminalId: "tm_1",
    }));
  });

  it("uses an OSC-supplied message as the toast text when given", () => {
    const { firer, fire } = setup(() => 1000);
    expect(firer.fire("tm_1", "Build finished — 0 errors")).toBe(true);
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({
      title: "Claude - SEO",
      text: "Build finished — 0 errors",
    }));
  });

  it("falls back to the default text when the message is empty/whitespace", () => {
    const { firer, fire } = setup(() => 1000);
    expect(firer.fire("tm_1", "   ")).toBe(true);
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({ text: "needs attention · client-apps" }));
  });

  it("dedupes repeated pings within the cooldown (many browsers / a bell burst → one toast)", () => {
    let t = 1000;
    const { firer, fire } = setup(() => t);
    expect(firer.fire("tm_1")).toBe(true);
    t = 2500; // < 4000ms later
    expect(firer.fire("tm_1")).toBe(false);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it("fires again once the cooldown has elapsed (a later, genuine finish)", () => {
    let t = 1000;
    const { firer, fire } = setup(() => t);
    expect(firer.fire("tm_1")).toBe(true);
    t = 1000 + 4000;
    expect(firer.fire("tm_1")).toBe(true);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("ignores an unknown terminal", () => {
    const { firer, fire } = setup(() => 1000);
    expect(firer.fire("tm_nope")).toBe(false);
    expect(fire).not.toHaveBeenCalled();
  });

  it("never fires for a plain-shell terminal — only AI-agent sessions earn attention", () => {
    // The exact screenshot bug: a "Plain terminal" (override "") living in a CLAUDE workspace. It must
    // NOT inherit the workspace agent, so a tab-completion bell or 10s of idle must never notify.
    const shell = term({ id: "tm_sh", workspaceId: "ws_1", launchCommandOverride: "" });
    const { firer, fire } = setup(() => 1000, { term: shell }); // default ws launchCommand = "claude"
    expect(firer.fire("tm_sh")).toBe(false);
    expect(fire).not.toHaveBeenCalled();
  });

  it("never fires for a registered non-agent custom launcher (e.g. 'npm run dev') — built-in agents only", () => {
    // Attention is for the built-in coding agents the app detects (claude/codex/…), NOT user-registered
    // custom launchers. A "npm run dev" custom agent must not turn npm/dev terminals into notifiers.
    const devTerm = term({ id: "tm_dev", workspaceId: "ws_1", launchCommandOverride: "npm run dev" });
    const customAgents: CustomAgent[] = [{ id: "ag1", name: "npm run dev", command: "npm run dev", icon: null, category: "Other", createdAt: 0 }];
    const { firer, fire } = setup(() => 1000, { term: devTerm, customAgents });
    expect(firer.fire("tm_dev")).toBe(false);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe("attentionFire — GUI-mode terminals", () => {
  it("fires for a GUI terminal even when the workspace launch command isn't an agent", () => {
    // A GUI terminal's pane holds a bare shell and it inherits the workspace's launch command, so
    // the agent-binary test would reject it in a workspace launching anything else. It IS a Claude
    // session by definition.
    const { firer, fire } = setup(() => 1000, {
      term: term({ mode: "gui" }),
      ws: ws({ launchCommand: "npm run dev" }),
    });
    expect(firer.fire("tm_1")).toBe(true);
    expect(fire).toHaveBeenCalledWith(expect.objectContaining({ terminalId: "tm_1", source: "attention" }));
  });

  it("still rejects a non-agent tmux terminal in the same workspace", () => {
    const { firer, fire } = setup(() => 1000, { ws: ws({ launchCommand: "npm run dev" }) });
    expect(firer.fire("tm_1")).toBe(false);
    expect(fire).not.toHaveBeenCalled();
  });

  it("applies the same per-terminal cooldown to a GUI terminal", () => {
    let t = 1000;
    const { firer, fire } = setup(() => t, { term: term({ mode: "gui" }) });
    expect(firer.fire("tm_1")).toBe(true);
    t = 2000;
    expect(firer.fire("tm_1")).toBe(false); // an approval prompt right after a turn end must not double-toast
    t = 6000;
    expect(firer.fire("tm_1")).toBe(true);
    expect(fire).toHaveBeenCalledTimes(2);
  });
});
