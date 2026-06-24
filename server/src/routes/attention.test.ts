import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { attentionRoutes } from "./attention.js";

/** Fake tmux that reports the given sessions as bell-flagged in list-windows output (silence off).
 *  Default settings mode is "layered", which honours the bell flag. */
function build(flagged: string[]) {
  const runner = async (args: string[]) => {
    if (args[0] === "list-windows") {
      // The store fixtures below use these two sessions. 3 cols: session, bell flag, silence flag.
      return ["tr_ws_a_tm_1", "tr_ws_a_tm_2"]
        .map(s => `${s} ${flagged.includes(s) ? 1 : 0} 0`)
        .join("\n");
    }
    return "";
  };
  const ctx = { store: createStore(":memory:"), tmux: createTmuxController(runner) };
  const ws = ctx.store.createWorkspace({ name: "API", folder: "/x", launchCommand: "", color: null });
  const t1 = ctx.store.createTerminal({ workspaceId: ws.id, title: "claude", color: null, tmuxSession: "tr_ws_a_tm_1", launchCommandOverride: null });
  const t2 = ctx.store.createTerminal({ workspaceId: ws.id, title: "codex", color: null, tmuxSession: "tr_ws_a_tm_2", launchCommandOverride: null });
  const app = Fastify();
  app.register(async a => attentionRoutes(a, ctx));
  return { app, ws, t1, t2 };
}

describe("attention route", () => {
  it("GET /api/attention returns terminals whose session has an unviewed bell", async () => {
    const { app, ws, t1 } = build(["tr_ws_a_tm_1"]);
    const res = await app.inject({ method: "GET", url: "/api/attention" });
    expect(res.statusCode).toBe(200);
    expect(res.json().attention).toEqual([
      { terminalId: t1.id, workspaceId: ws.id, workspaceName: "API", title: "claude" },
    ]);
  });

  it("GET /api/attention is empty when nothing is flagged", async () => {
    const { app } = build([]);
    const res = await app.inject({ method: "GET", url: "/api/attention" });
    expect(res.json().attention).toEqual([]);
  });
});
