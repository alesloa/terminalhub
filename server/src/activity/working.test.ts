import { describe, it, expect } from "vitest";
import {
  agentBinary,
  effectiveLaunch,
  agentBinaries,
  isAgentTerminal,
  isAgentWorkingNow,
  createWorkingTracker,
} from "./working.js";
import type { Terminal, Workspace, CustomAgent } from "../types.js";
import type { AppContext } from "../context.js";

const ws = (id: string, launchCommand = "claude"): Workspace => ({
  id, name: id, folder: "/x", launchCommand, color: null, x: 0, y: 0, createdAt: 0, updatedAt: 0,
});
const tm = (id: string, workspaceId: string, tmuxSession: string, override: string | null = null): Terminal => ({
  id, workspaceId, title: id, color: null, tmuxSession, launchCommandOverride: override, createdAt: 0,
});

describe("agentBinary", () => {
  it("takes the first token's basename, lowercased", () => {
    expect(agentBinary("claude")).toBe("claude");
    expect(agentBinary("claude --resume")).toBe("claude");
    expect(agentBinary("/usr/local/bin/Codex --foo")).toBe("codex");
    expect(agentBinary("  gemini   chat ")).toBe("gemini");
    expect(agentBinary("")).toBe("");
  });

  it("unwraps a `headroom wrap <agent>` launcher to the wrapped agent", () => {
    // The Headroom proxy launches as `headroom wrap claude …`; without unwrapping, the binary would
    // read as "headroom" and the terminal would never be detected as an agent (no working indicator).
    expect(agentBinary('headroom wrap claude --model "opus[1m]"')).toBe("claude");
    expect(agentBinary("headroom wrap claude --resume abc123")).toBe("claude");
    expect(agentBinary("headroom wrap codex")).toBe("codex");
    expect(agentBinary("/Users/me/.local/bin/headroom wrap claude")).toBe("claude");
    expect(agentBinary("headroom")).toBe("headroom"); // bare headroom (no `wrap`) is left as-is
  });
});

describe("effectiveLaunch", () => {
  it("prefers a non-empty per-terminal override over the workspace command", () => {
    expect(effectiveLaunch(tm("t", "w", "s", "codex"), ws("w", "claude"))).toBe("codex");
  });
  it("falls back to the workspace launch command when the override is blank", () => {
    expect(effectiveLaunch(tm("t", "w", "s", "  "), ws("w", "claude"))).toBe("claude");
    expect(effectiveLaunch(tm("t", "w", "s", null), ws("w", "claude"))).toBe("claude");
  });
  it("is empty when neither is set", () => {
    expect(effectiveLaunch(tm("t", "w", "s", null), ws("w", ""))).toBe("");
    expect(effectiveLaunch(tm("t", "w", "s", null), undefined)).toBe("");
  });
});

describe("agentBinaries / isAgentTerminal", () => {
  const agents: CustomAgent[] = [
    { id: "a1", name: "Aider", command: "aider --model x", icon: null, category: "Other", createdAt: 0 },
  ];
  const bins = agentBinaries(agents);

  it("includes the built-in agents and every custom agent's binary", () => {
    expect(bins.has("claude")).toBe(true);
    expect(bins.has("codex")).toBe(true);
    expect(bins.has("gemini")).toBe(true);
    expect(bins.has("aider")).toBe(true);
  });

  it("treats known agent commands as agent terminals", () => {
    expect(isAgentTerminal("claude --resume", bins)).toBe(true);
    expect(isAgentTerminal("aider", bins)).toBe(true);
  });

  it("rejects plain shells and app/dev-server commands", () => {
    expect(isAgentTerminal("", bins)).toBe(false);
    expect(isAgentTerminal("npm run dev", bins)).toBe(false);
    expect(isAgentTerminal("nx serve web", bins)).toBe(false);
    expect(isAgentTerminal("python app.py", bins)).toBe(false);
    expect(isAgentTerminal("next dev", bins)).toBe(false);
  });
});

describe("isAgentWorkingNow", () => {
  it("matches Claude's live in-flight turn line (gerund ellipsis + elapsed timer)", () => {
    // Real captures.
    expect(isAgentWorkingNow("✻ Stewing… (4m 40s · ↓ 8.0k tokens · still thinking with xhigh effort)")).toBe(true);
    expect(isAgentWorkingNow("  ⏺ tool output\n✽ Forging… (12s · ↑ 1.2k tokens)\n❯ ")).toBe(true);
    expect(isAgentWorkingNow("✻ Brewing… (11s)")).toBe(true);     // short form, seconds only
    expect(isAgentWorkingNow("✻ Pondering… (1h 2m · …)")).toBe(true); // long turn, hours
  });

  it("does NOT match a finished turn, idle prompt, or statusline", () => {
    expect(isAgentWorkingNow("✻ Brewed for 11s")).toBe(false);              // finished: past tense, "for", no ellipsis
    expect(isAgentWorkingNow("* Cogitated for 11s")).toBe(false);
    expect(isAgentWorkingNow("✻ Sautéed for 1m 23s · 2 shells still running")).toBe(false);
    expect(isAgentWorkingNow("❯ ")).toBe(false);
    expect(isAgentWorkingNow("  /Volumes/…/x  ⎇ main  ◆ Opus 4.8  ⬡ ▰▱▱▱▱ 28%  ⊙ 06:35:30 ")).toBe(false);
  });

  it("does NOT match the model context label or a truncated path (look-alikes)", () => {
    expect(isAgentWorkingNow("  /Volumes/…/myapp  ◆ Opus 4.8 (1M context)  ⊙ 05:21:40 ")).toBe(false);
    expect(isAgentWorkingNow("  /Volumes/…/tuapp  ⎇ master  ◆ Opus 4.8")).toBe(false);
  });

  it("does NOT match scrolling dev-server / cron logs (the flicker source)", () => {
    const logs = '{"level":30,"time":1781528299573,"reqId":"req-z","res":{"statusCode":200},"msg":"request completed"}\n'
      + '{"level":30,"time":1781528340384,"job":"restaurant-uber-dispatch","msg":"Cron job completed"}';
    expect(isAgentWorkingNow(logs)).toBe(false);
  });

  it("does NOT match a replayed conversation transcript with no live spinner", () => {
    const replay = "❯ hi\n● Hi. Last commit 96bc9cf landed. What next?\n✻ Cogitated for 11s\n❯ ";
    expect(isAgentWorkingNow(replay)).toBe(false);
  });

  it("matches subagent orchestration — running Task subagents with live token meters", () => {
    // Real capture: the main line is `✻ Waiting for 5 background agents to finish` (no ellipsis, no
    // (elapsed) paren), and each running subagent shows a live `<elapsed> · ↓ <N> tokens` meter.
    const subagents = [
      "✻ Waiting for 5 background agents to finish",
      "❯ ",
      "   /Volumes/…/web  ⎇ master!?⇡21  ◆ Opus 4.8 (1M context)  ⬡ ▰▱▱▱▱ 20% ↑203.9k ↓1.3k cr:190.7k cw:13.1k  $10.42  ⊙ 07:33:48 ",
      "  ⏺ main",
      "  ◯ general-purpose  Verifying Truck and Gift icons exist     3m 14s · ↓ 67.8k tokens",
      "  ◯ general-purpose  Writing v3.css scoped styles             2m 50s · ↓ 59.5k tokens",
    ].join("\n");
    expect(isAgentWorkingNow(subagents)).toBe(true);
  });

  it("matches the 'waiting for N background agents' line on its own", () => {
    expect(isAgentWorkingNow("✻ Waiting for 5 background agents to finish\n❯ ")).toBe(true);
  });

  it("does NOT mistake the statusline's own token counters (cr:/cw:) for a live meter", () => {
    // The statusline shows `↑203.9k ↓1.3k cr:190.7k cw:13.1k` with NO adjacent word "tokens".
    const idleWithStatuslineCounters = "✻ Brewed for 11s\n❯ \n   ◆ Opus 4.8  ⬡ ▰▱▱▱▱ 20% ↑203.9k ↓1.3k cr:190.7k cw:13.1k  ⊙ 07:33:48 ";
    expect(isAgentWorkingNow(idleWithStatuslineCounters)).toBe(false);
  });
});

describe("isAgentWorkingNow — non-Claude agents (per-binary signatures)", () => {
  it("codex: matches the running-turn footer `(… • esc to interrupt)`", () => {
    // codex-rs status_indicator_widget.rs — `Working (12s • esc to interrupt)`. The `to interrupt)`
    // suffix is invariant even if the header word or interrupt keybinding is remapped.
    expect(isAgentWorkingNow("Working (12s • esc to interrupt)", "codex")).toBe(true);
    expect(isAgentWorkingNow("⠋ Working (1m 05s • esc to interrupt)\n", "codex")).toBe(true);
    expect(isAgentWorkingNow("• Working (0s • f12 to interrupt)", "codex")).toBe(true); // remapped key
  });
  it("codex: does NOT match the idle composer", () => {
    expect(isAgentWorkingNow("▌ Ask Codex to do something\n", "codex")).toBe(false);
    expect(isAgentWorkingNow("⏎ send   esc clear", "codex")).toBe(false);
  });

  it("gemini: matches the cancel/timer footer `(esc to cancel, …)`", () => {
    expect(isAgentWorkingNow("✦ Reticulating splines (esc to cancel, 7s)", "gemini")).toBe(true);
    expect(isAgentWorkingNow("Thinking... (esc to cancel, 1m 5s)", "gemini")).toBe(true);
  });
  it("gemini: does NOT match the idle prompt", () => {
    expect(isAgentWorkingNow("Type your message or @path/to/file", "gemini")).toBe(false);
  });

  it("opencode: matches the Go-TUI task words and busy hint", () => {
    expect(isAgentWorkingNow("⣾ Thinking...", "opencode")).toBe(true);
    expect(isAgentWorkingNow("⣾ Generating...", "opencode")).toBe(true);
    expect(isAgentWorkingNow("Waiting for tool response...", "opencode")).toBe(true);
    expect(isAgentWorkingNow("Building tool call...", "opencode")).toBe(true);
    expect(isAgentWorkingNow("press esc to exit cancel", "opencode")).toBe(true);
  });
  it("opencode: matches the new OpenTUI interrupt hint", () => {
    expect(isAgentWorkingNow("[⋯]  esc interrupt", "opencode")).toBe(true);
    expect(isAgentWorkingNow("esc again to interrupt", "opencode")).toBe(true);
  });
  it("opencode: does NOT match bare-esc idle/shell footers", () => {
    expect(isAgentWorkingNow("esc exit shell mode", "opencode")).toBe(false);
    expect(isAgentWorkingNow("esc normal", "opencode")).toBe(false);
    expect(isAgentWorkingNow("press enter to send the message, esc to clear", "opencode")).toBe(false);
  });

  it("cursor-agent: matches the `Generating…` busy label (ellipsis or three dots)", () => {
    expect(isAgentWorkingNow("Generating…", "cursor-agent")).toBe(true);
    expect(isAgentWorkingNow("⠋ Generating...", "cursor-agent")).toBe(true);
  });
  it("cursor-agent: does NOT match the idle prompt", () => {
    expect(isAgentWorkingNow("> Plan, search, build anything", "cursor-agent")).toBe(false);
  });

  it("keys signatures by binary — one agent's footer does not light up another", () => {
    // codex's `esc to interrupt)` is not gemini's footer, and gemini's `(esc to cancel,` is not codex's.
    expect(isAgentWorkingNow("Working (12s • esc to interrupt)", "gemini")).toBe(false);
    expect(isAgentWorkingNow("(esc to cancel, 7s)", "codex")).toBe(false);
    expect(isAgentWorkingNow("Generating…", "gemini")).toBe(false);
  });

  it("unknown binary falls back to matching any known agent's signature", () => {
    // A registered custom agent we don't ship a dedicated pattern for still lights up if its pane
    // shows a recognised in-flight shape — never worse than before (was Claude-only).
    expect(isAgentWorkingNow("Working (3s • esc to interrupt)", "aider")).toBe(true);
    expect(isAgentWorkingNow("✻ Stewing… (4m 40s · …)", "aider")).toBe(true);
    expect(isAgentWorkingNow("❯ ", "aider")).toBe(false);
  });
});

describe("createWorkingTracker", () => {
  function fakeCtx(opts: {
    terminals: Terminal[]; workspaces: Workspace[]; live: string[];
    panes: Record<string, string>; agents?: CustomAgent[];
  }): AppContext {
    return {
      store: {
        listAllTerminals: () => opts.terminals,
        listWorkspaces: () => opts.workspaces,
        listCustomAgents: () => opts.agents ?? [],
      },
      tmux: {
        listSessions: async () => opts.live,
        capturePane: async (name: string) => opts.panes[name] ?? "",
      },
    } as unknown as AppContext;
  }

  it("reports an agent terminal whose pane shows a live in-flight turn", async () => {
    const ctx = fakeCtx({
      terminals: [tm("t_busy", "w", "s_busy"), tm("t_idle", "w", "s_idle")],
      workspaces: [ws("w", "claude")],
      live: ["s_busy", "s_idle"],
      panes: {
        s_busy: "✻ Stewing… (4m 40s · ↓ 8.0k tokens · still thinking)\n❯ ",
        s_idle: "✻ Brewed for 11s\n❯ ", // finished turn → idle
      },
    });
    const tracker = createWorkingTracker(ctx);
    expect(await tracker.compute()).toEqual([{ terminalId: "t_busy", workspaceId: "w" }]);
  });

  it("reports a headroom-wrapped agent terminal that's working", async () => {
    // `headroom wrap claude` still runs Claude's TUI, so the in-flight pattern matches; the terminal
    // just has to be recognised as an agent despite the wrapper prefix.
    const ctx = fakeCtx({
      terminals: [tm("t_hr", "w", "s_hr", 'headroom wrap claude --model "opus[1m]"')],
      workspaces: [ws("w", "claude")],
      live: ["s_hr"],
      panes: { s_hr: "✻ Caramelizing… (1m 2s · ↓ 3.5k tokens · thinking with xhigh effort)\n❯ " },
    });
    const tracker = createWorkingTracker(ctx);
    expect(await tracker.compute()).toEqual([{ terminalId: "t_hr", workspaceId: "w" }]);
  });

  it("reports a working codex terminal (per-binary signature, not Claude's)", async () => {
    const ctx = fakeCtx({
      terminals: [tm("t_cx", "w", "s_cx", "codex")],
      workspaces: [ws("w", "claude")],
      live: ["s_cx"],
      panes: { s_cx: "• Working (8s • esc to interrupt)\n▌ " },
    });
    const tracker = createWorkingTracker(ctx);
    expect(await tracker.compute()).toEqual([{ terminalId: "t_cx", workspaceId: "w" }]);
  });

  it("ignores a freshly-opened / resumed / idle session (no live turn line)", async () => {
    const ctx = fakeCtx({
      terminals: [tm("t1", "w", "s1")],
      workspaces: [ws("w", "claude --resume")],
      live: ["s1"],
      panes: { s1: "❯ hi\n● Hi. Last commit 96bc9cf landed. What next?\n✻ Cogitated for 11s\n❯ " },
    });
    const tracker = createWorkingTracker(ctx);
    expect(await tracker.compute()).toEqual([]); // replay/idle never reports working
  });

  it("ignores a non-agent (dev-server log) terminal even when its launch command is an agent", async () => {
    // launchCommand is "claude" but the pane is streaming API/cron logs — must NOT report working.
    const ctx = fakeCtx({
      terminals: [tm("t_log", "w", "s_log")],
      workspaces: [ws("w", "claude")],
      live: ["s_log"],
      panes: { s_log: '{"level":30,"time":1781528340384,"msg":"Cron job completed"}\n{"level":30,"msg":"request completed"}' },
    });
    const tracker = createWorkingTracker(ctx);
    expect(await tracker.compute()).toEqual([]);
  });

  it("skips dead sessions and app terminals (excluded by command)", async () => {
    const ctx = fakeCtx({
      terminals: [tm("t_app", "w_app", "s_app"), tm("t_dead", "w", "s_dead")],
      workspaces: [ws("w_app", "npm run dev"), ws("w", "claude")],
      live: ["s_app"], // s_dead absent → never captured
      panes: { s_app: "✻ Stewing… (4m 40s · ↓ 8.0k tokens)" }, // looks busy but command is a dev server
    });
    const tracker = createWorkingTracker(ctx);
    expect(await tracker.compute()).toEqual([]); // app excluded by command; dead session skipped
  });
});
