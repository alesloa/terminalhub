import type { AppContext } from "../context.js";
import type { CustomAgent, Terminal, Workspace } from "../types.js";
import { BUILTIN_AGENTS } from "../agents/registry.js";

// "Working" detection — which AI agents are actively thinking/streaming right now, so the canvas can
// animate the card (the KITT sweep + the pulsing terminal dots). Distinct from the bell-based "needs
// attention" state (see ../attention/attention.ts): attention = it wants YOU; working = it's mid-turn.
//
// We do NOT diff the pane for "did anything change". That conflates real thinking with scrolling dev
// logs, a replayed `claude --resume` transcript, a ticking statusline clock, or the launch banner —
// all of which change the screen while the agent is idle, and caused false "working" + flicker.
//
// Instead this is PRESENCE-based: a terminal is working iff its visible pane shows the agent's live
// in-flight turn line RIGHT NOW (see isAgentWorkingNow). That line is on screen for the whole turn
// (including tool/subagent waits) and absent the instant the turn ends — so it never flickers and a
// freshly-opened / resumed / idle session reads idle until you actually get a response going.
//
// We only sample terminals whose launch command is a known agent (claude/codex/gemini or a registered
// custom agent); a `npm run dev` terminal is excluded by command so it never lights up.

/** A terminal whose agent is actively working (thinking / streaming). */
export interface WorkingItem {
  terminalId: string;
  workspaceId: string;
}

/** Binaries of the built-in coding agents (claude, codex, gemini, opencode, cursor-agent), taken
 *  straight from the agent registry so this allowlist never drifts from it. Anything else the user
 *  runs as an agent is covered by their registered custom agents (see agentBinaries). Apps/dev
 *  servers are intentionally absent. */
export const KNOWN_AGENT_BINARIES = BUILTIN_AGENTS.map((a) => a.bin);

/** Basename of a token, lowercased: "/usr/local/bin/Codex" → "codex". */
function basename(token: string): string {
  return (token.split("/").pop() ?? token).toLowerCase();
}

/** First token of a command, reduced to its lowercased basename: "claude --resume" → "claude",
 *  "/usr/local/bin/Codex" → "codex". "" for an empty command. A `headroom wrap <agent> …` launcher
 *  is unwrapped to the wrapped agent ("headroom wrap claude" → "claude") so a Headroom-proxied
 *  terminal is still recognised as its real agent (otherwise it'd read as "headroom" and never get
 *  sampled for the working indicator). */
export function agentBinary(cmd: string): string {
  const tokens = (cmd ?? "").trim().split(/\s+/);
  if (basename(tokens[0] ?? "") === "headroom" && (tokens[1] ?? "").toLowerCase() === "wrap" && tokens[2]) {
    return basename(tokens[2]);
  }
  return basename(tokens[0] ?? "");
}

/** The command a terminal actually launched: its per-terminal override if set, else the workspace
 *  default. "" for a plain shell. A NON-NULL override is authoritative — even "" (the "Plain terminal"
 *  card stores override "" and must stay a shell, never inheriting the workspace's agent). Only a null
 *  override (unset) inherits the workspace command. Mirrors the web's `override ?? wsLaunch` (`??`,
 *  NOT `||`) — collapsing "" into the fallback is exactly what misclassified plain shells as agents. */
export function effectiveLaunch(t: Terminal, ws: Workspace | undefined): string {
  if (t.launchCommandOverride != null) return t.launchCommandOverride.trim();
  return ws?.launchCommand?.trim() ?? "";
}

/** The set of binaries we treat as agents: the built-ins plus every registered custom agent's. */
export function agentBinaries(customAgents: CustomAgent[]): Set<string> {
  const bins = new Set(KNOWN_AGENT_BINARIES);
  for (const a of customAgents) {
    const b = agentBinary(a.command);
    if (b) bins.add(b);
  }
  return bins;
}

/** True when a launch command runs one of our known agents (and not a shell/app/dev server). */
export function isAgentTerminal(cmd: string, agentBins: Set<string>): boolean {
  const b = agentBinary(cmd);
  return b !== "" && agentBins.has(b);
}

// Each agent prints its OWN on-screen line(s) while a turn is genuinely in flight, and each is absent
// at rest. We key the patterns by agent binary (see IN_FLIGHT) so one agent's footer can't light up
// another's. All are presence signals (no diffing), taken from each TUI's real source — or, for the
// closed-source Cursor CLI, a real terminal transcript.

// Claude — three shapes; we match any:
//  1. The single thinking line — `✻ Stewing… (4m 40s · ↓ 8.0k tokens · still thinking…)`. Key on the
//     gerund ELLIPSIS immediately followed by the elapsed-time parenthesis `(4m 40s` / `(11s` /
//     `(1h 2m`. A finished turn collapses to `✻ Brewed for 11s` (past tense, "for", no ellipsis, no
//     elapsed paren). Requiring `(<digit><h|m|s>` after the ellipsis also rejects path truncations
//     (`/Volumes/…/x`) and the model label (`Opus 4.8 (1M context)`).
//  2. The live token meter — `↓ 8.0k tokens` / `↑ 1.2k tokens`. Present on the long thinking line AND
//     on each running background/Task subagent line, where shape #1 is absent. The arrow + number +
//     the word "tokens" is specific to the live meter; the statusline's own counters read `↑203.9k
//     ↓1.3k cr:… cw:…` (no "tokens"), so they don't match.
//  3. The parallel-agents wait line — `✻ Waiting for 5 background agents to finish`.
const CLAUDE_IN_FLIGHT = /…\s*\(\d+\s*[hms]/;
const CLAUDE_TOKEN_METER = /[↑↓]\s*[\d.]+\s*k?\s+tokens/;
const CLAUDE_WAITING_AGENTS = /Waiting for \d+ background agent/;

// Codex (OpenAI, Rust TUI): the running-turn status footer `Working (12s • esc to interrupt)`. The
// `to interrupt)` suffix is invariant — the header word and the interrupt keybinding can both be
// remapped (e.g. `f12 to interrupt`), but the suffix and the closing paren survive — and it's absent
// at the idle composer. Source: codex-rs/tui/src/status_indicator_widget.rs.
const CODEX_IN_FLIGHT = /to interrupt\)/;

// Gemini (Google, Ink TUI): the cancel/timer footer `(esc to cancel, 12s)`, rendered only while the
// turn is responding. The witty "Thinking…" phrases rotate and are user-disableable, so anchor on
// the stable cancel hint. Source: packages/cli/src/ui/components/LoadingIndicator.tsx.
const GEMINI_IN_FLIGHT = /\(esc to cancel,/;

// opencode (SST → anomalyco): two TUIs ship in the wild. The Go/Bubbletea build shows task words
// (`Thinking...` / `Generating...` / `Waiting for tool response...` / `Building tool call...`) and
// the busy help hint `… to exit cancel`; the newer Solid/OpenTUI build shows `esc interrupt` /
// `esc again to interrupt`. Match either family. Bare `esc` is deliberately NOT matched — it also
// appears in idle/shell footers (`esc exit shell mode`, `esc normal`). Sources: opencode-ai/opencode
// internal/tui/components/chat/list.go; anomalyco/opencode packages/tui/src/component/prompt/index.tsx.
const OPENCODE_IN_FLIGHT =
  /Thinking\.\.\.|Generating\.\.\.|Waiting for tool response\.\.\.|Building tool call\.\.\.|to exit cancel|esc(?: again)?(?: to)? interrupt/;

// Cursor (cursor-agent, closed source): the busy label `Generating…` (Unicode ellipsis U+2026; some
// transcriptions render it as three ASCII dots). It's the only publicly-verified in-flight string —
// the interrupt-hint wording isn't documented. Source: real terminal transcript, forum.cursor.com.
const CURSOR_IN_FLIGHT = /Generating(?:…|\.\.\.)/;

/** In-flight signatures per agent binary. A pane reads "working" iff it matches one of ITS agent's
 *  signatures — keyed so e.g. a codex footer never lights up a gemini terminal. */
const IN_FLIGHT: Record<string, RegExp[]> = {
  claude: [CLAUDE_IN_FLIGHT, CLAUDE_TOKEN_METER, CLAUDE_WAITING_AGENTS],
  codex: [CODEX_IN_FLIGHT],
  gemini: [GEMINI_IN_FLIGHT],
  opencode: [OPENCODE_IN_FLIGHT],
  "cursor-agent": [CURSOR_IN_FLIGHT],
};

/** Every known signature, flattened — the fallback for a custom agent we don't ship a dedicated
 *  pattern for, so it still lights up on any recognised in-flight shape (never worse than Claude-only). */
const ANY_IN_FLIGHT = Object.values(IN_FLIGHT).flat();

/** True when the pane currently shows a live in-flight turn for `agentBin` (thinking, streaming, or
 *  running subagents). Presence-based, so it needs no prior sample and no time-to-live — these shapes
 *  are on screen for the whole turn and gone the moment it ends, so the indicator can't flicker
 *  mid-turn or linger after it. Pass the terminal's agent binary so only that agent's patterns run;
 *  omit it (or pass an unrecognised binary, e.g. a custom agent) to match any known agent's shape. */
export function isAgentWorkingNow(paneText: string, agentBin?: string): boolean {
  const sigs = (agentBin && IN_FLIGHT[agentBin]) || ANY_IN_FLIGHT;
  return sigs.some((re) => re.test(paneText));
}

/**
 * Stateless tracker: each compute() captures every live agent terminal's pane and reports the ones
 * whose pane shows a live in-flight turn (isAgentWorkingNow). No history, no TTL — presence is the
 * whole signal. Created once per app and called by GET /api/working on each canvas poll, so sampling
 * only happens while someone is looking at the canvas.
 */
export function createWorkingTracker(ctx: AppContext) {
  return {
    async compute(): Promise<WorkingItem[]> {
      const workspaces = ctx.store.listWorkspaces();
      const wsById = new Map(workspaces.map((w) => [w.id, w]));
      const bins = agentBinaries(ctx.store.listCustomAgents());

      const live = new Set(await ctx.tmux.listSessions());
      const agentTerms = ctx.store
        .listAllTerminals()
        .map((t) => ({ t, bin: agentBinary(effectiveLaunch(t, wsById.get(t.workspaceId))) }))
        .filter(({ t, bin }) => live.has(t.tmuxSession) && bin !== "" && bins.has(bin));

      const results = await Promise.all(
        agentTerms.map(async ({ t, bin }) => {
          const text = await ctx.tmux.capturePane(t.tmuxSession).catch(() => "");
          return isAgentWorkingNow(text, bin) ? { terminalId: t.id, workspaceId: t.workspaceId } : null;
        }),
      );
      return results.filter((r): r is WorkingItem => r !== null);
    },
  };
}
