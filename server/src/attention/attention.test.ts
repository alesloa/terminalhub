import { describe, it, expect } from "vitest";
import { attentionFrom } from "./attention.js";
import type { WindowFlags } from "../tmux/controller.js";
import type { Terminal, Workspace } from "../types.js";

const ws = (id: string, name: string): Workspace => ({
  id, name, folder: "/x", launchCommand: "", color: null, x: 0, y: 0, createdAt: 0, updatedAt: 0,
});
const tm = (id: string, workspaceId: string, tmuxSession: string, title: string): Terminal => ({
  id, workspaceId, title, color: null, tmuxSession, launchCommandOverride: null, createdAt: 0,
});
const flags = (b: boolean, s: boolean): WindowFlags => ({ bell: b, silence: s });

describe("attentionFrom — mode-aware picker", () => {
  const terminals = [
    tm("tm_bell", "ws_a", "tr_ws_a_tm_bell", "claude"),
    tm("tm_silent", "ws_a", "tr_ws_a_tm_silent", "codex"),
    tm("tm_both", "ws_a", "tr_ws_a_tm_both", "aider"),
    tm("tm_idle", "ws_a", "tr_ws_a_tm_idle", "shell"),
  ];
  const workspaces = [ws("ws_a", "API")];
  const map = new Map<string, WindowFlags>([
    ["tr_ws_a_tm_bell", flags(true, false)],
    ["tr_ws_a_tm_silent", flags(false, true)],
    ["tr_ws_a_tm_both", flags(true, true)],
    ["tr_ws_a_tm_idle", flags(false, false)],
  ]);
  const ids = (mode: "layered" | "explicit" | "silence") =>
    attentionFrom(map, terminals, workspaces, mode).map(i => i.terminalId).sort();

  it("explicit mode flags only the bell (and both), never silence-only", () => {
    expect(ids("explicit")).toEqual(["tm_bell", "tm_both"]);
  });

  it("silence mode flags only the silent (and both), never bell-only", () => {
    expect(ids("silence")).toEqual(["tm_both", "tm_silent"]);
  });

  it("layered mode flags anything with either signal", () => {
    expect(ids("layered")).toEqual(["tm_bell", "tm_both", "tm_silent"]);
  });

  it("carries the workspace name, falling back to empty when the workspace is missing", () => {
    const orphan = [tm("tm_x", "ws_gone", "tr_ws_a_tm_bell", "x")];
    const out = attentionFrom(map, orphan, [], "explicit");
    expect(out).toEqual([{ terminalId: "tm_x", workspaceId: "ws_gone", workspaceName: "", title: "x" }]);
  });

  it("ignores a terminal with no entry in the flags map", () => {
    const out = attentionFrom(new Map(), [tm("tm_1", "ws_a", "tr_ws_a_tm_1", "x")], workspaces, "layered");
    expect(out).toEqual([]);
  });
});
