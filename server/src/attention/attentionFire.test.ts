import { describe, it, expect, vi } from "vitest";
import { createAttentionFirer } from "./attentionFire.js";
import type { Terminal, Workspace } from "../types.js";

const term = (over: Partial<Terminal> = {}): Terminal => ({
  id: "tm_1", workspaceId: "ws_1", title: "Claude - SEO", color: null, icon: null,
  tmuxSession: "tr_ws_1_tm_1", launchCommandOverride: null, position: 0, createdAt: 0, titleAuto: true,
  ...over,
});
const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: "ws_1", name: "client-apps", folder: "/x", launchCommand: "claude", color: null, cardColor: null,
  layout: null, spaceId: null, config: null, x: 0, y: 0, createdAt: 0, updatedAt: 0, ...over,
});

function setup(now: () => number) {
  const fire = vi.fn(() => "pn_1");
  const store = {
    getTerminal: (id: string) => (id === "tm_1" ? term() : undefined),
    getWorkspace: (id: string) => (id === "ws_1" ? ws() : undefined),
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
});
