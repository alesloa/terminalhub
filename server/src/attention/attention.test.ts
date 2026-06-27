import { describe, it, expect } from "vitest";
import { attentionFrom, computeAttention } from "./attention.js";
import { agentBinaries } from "../activity/working.js";
import type { AppContext } from "../context.js";
import type { WindowFlags } from "../tmux/controller.js";
import type { Terminal, Workspace } from "../types.js";

// Built-in agent binaries (claude, codex, gemini, opencode, cursor-agent); no custom agents.
const BINS = agentBinaries([]);

// `launch` is the workspace's launch command — "claude" by default so its terminals read as agent
// sessions; pass "" for a plain shell (which must never earn attention).
const ws = (id: string, name: string, launch = "claude"): Workspace => ({
  id, name, folder: "/x", launchCommand: launch, color: null, x: 0, y: 0, createdAt: 0, updatedAt: 0,
});
const tm = (id: string, workspaceId: string, tmuxSession: string, title: string, launch: string | null = null): Terminal => ({
  id, workspaceId, title, color: null, tmuxSession, launchCommandOverride: launch, createdAt: 0,
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
    attentionFrom(map, terminals, workspaces, mode, BINS).map(i => i.terminalId).sort();

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
    // Agent via per-terminal override, so a missing workspace doesn't strip its agent status.
    const orphan = [tm("tm_x", "ws_gone", "tr_ws_a_tm_bell", "x", "claude")];
    const out = attentionFrom(map, orphan, [], "explicit", BINS);
    expect(out).toEqual([{ terminalId: "tm_x", workspaceId: "ws_gone", workspaceName: "", title: "x" }]);
  });

  it("ignores a terminal with no entry in the flags map", () => {
    const out = attentionFrom(new Map(), [tm("tm_1", "ws_a", "tr_ws_a_tm_1", "x")], workspaces, "layered", BINS);
    expect(out).toEqual([]);
  });

  it("never flags a plain-shell terminal — only AI-agent sessions earn attention", () => {
    // A regular shell ringing the bell or going quiet must not notify, in any mode. Two shapes:
    //  • a plain WORKSPACE (launchCommand ""), inherited by a null-override terminal, and
    //  • the "Plain terminal" card (override "") living inside a CLAUDE workspace — the screenshot bug.
    const shells = [
      tm("tm_sh_bell", "ws_sh", "tr_ws_sh_tm_bell", "zsh"),                 // plain ws, inherited
      tm("tm_sh_quiet", "ws_sh", "tr_ws_sh_tm_quiet", "bash"),              // plain ws, inherited
      tm("tm_sh_in_agent", "ws_agent", "tr_ws_a_tm_shell", "Terminal", ""), // override "" in a claude ws
    ];
    const workspaces = [ws("ws_sh", "Scratch", ""), ws("ws_agent", "API", "claude")];
    const fl = new Map<string, WindowFlags>([
      ["tr_ws_sh_tm_bell", flags(true, false)],
      ["tr_ws_sh_tm_quiet", flags(false, true)],
      ["tr_ws_a_tm_shell", flags(true, true)],
    ]);
    expect(attentionFrom(fl, shells, workspaces, "layered", BINS)).toEqual([]);
  });
});

describe("computeAttention — bell-only (explicit), never silence", () => {
  // Attention is bell-only: a backgrounded agent earns attention when it RINGS THE BELL on finishing —
  // NOT when it merely goes quiet. Silence flagged EVERY idle session (they all look "quiet"), which
  // flooded notifications, so silence-only never counts. The stored attentionMode is ignored (forced
  // explicit); attention is not user-controlled; built-in coding agents only.
  it("flags a bell terminal but NOT a silence-only one, even when settings say 'layered'", async () => {
    const terminals = [
      tm("tm_bell", "ws_a", "tr_ws_a_tm_bell", "claude"),
      tm("tm_silent", "ws_a", "tr_ws_a_tm_silent", "codex"),
    ];
    const ctx = {
      tmux: { windowFlags: async () => new Map<string, WindowFlags>([
        ["tr_ws_a_tm_bell", flags(true, false)],
        ["tr_ws_a_tm_silent", flags(false, true)],
      ]) },
      store: {
        listAllTerminals: () => terminals,
        listWorkspaces: () => [ws("ws_a", "API")],
        listCustomAgents: () => [],
        getSettings: () => ({ attentionMode: "layered" }), // ignored — bell-only is forced
      },
    } as unknown as AppContext;
    const out = await computeAttention(ctx);
    expect(out.map(i => i.terminalId)).toEqual(["tm_bell"]);
  });

  it("does NOT flag a registered custom launcher (npm run dev) even on a bell — built-in agents only", async () => {
    // An "npm run dev" custom agent folded "npm" into the allowlist, so dev terminals notified.
    // Attention uses ONLY the built-in coding agents now; custom launchers never notify — bell or not.
    const terminals = [tm("tm_dev", "ws_a", "tr_ws_a_tm_dev", "npm run dev", "npm run dev")];
    const ctx = {
      tmux: { windowFlags: async () => new Map<string, WindowFlags>([["tr_ws_a_tm_dev", flags(true, false)]]) },
      store: {
        listAllTerminals: () => terminals,
        listWorkspaces: () => [ws("ws_a", "page-build", "claude")],
        listCustomAgents: () => [{ id: "ag1", name: "npm run dev", command: "npm run dev", icon: null, category: "Other", createdAt: 0 }],
        getSettings: () => ({ attentionMode: "layered" }),
      },
    } as unknown as AppContext;
    expect(await computeAttention(ctx)).toEqual([]);
  });
});
