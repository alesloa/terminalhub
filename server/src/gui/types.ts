// The GUI-mode chat contract. This file is the single source of truth for everything that crosses
// the /ws/gui socket, so the web mirror (web/src/api/guiTypes.ts) must be kept in sync by hand —
// the same convention the rest of the app uses for server/src/types.ts ↔ web/src/api/types.ts.
//
// Shape rationale: a turn is a list of messages, a message is a list of blocks, and a block is the
// smallest thing the UI draws (a paragraph of assistant text, a thinking trace, or one tool call
// with its result). Streaming is expressed as block.start → block.delta* → block.end so the client
// can append characters without re-rendering the whole transcript.

import type { GuiConfig } from "./config.js";

/** Which surface a terminal is currently running: the tmux pane, or the in-app chat. */
export type GuiMode = "tmux" | "gui";

/** Which CLI a GUI chat drives. Decided from the terminal's launch command — see gui/agent.ts. */
export type GuiAgent = "claude" | "codex";

/** Lifecycle of the SDK-backed Claude process behind a GUI terminal. */
export type GuiSessionState = "idle" | "starting" | "running" | "waiting" | "stopped" | "error";

/** `aborted` = the run ended before the call reported back (interrupt, crash, hub restart). It is
 *  not a failure — nothing came back either way — so it must not read as one. */
export type GuiToolStatus = "running" | "ok" | "error" | "aborted";

export type GuiBlock =
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  /** An image the user attached to their turn. Held as a data URI payload because that is exactly
   *  what was sent to the model — there is no file on disk to point at. */
  | { kind: "image"; id: string; mediaType: string; dataBase64: string }
  | {
      kind: "tool";
      id: string;
      /** The SDK's tool_use id — the join key a tool_result arrives under. */
      toolUseId: string;
      name: string;
      /** Raw tool input. Left `unknown` on purpose: the renderer specialises per tool name. */
      input: unknown;
      status: GuiToolStatus;
      result?: string;
    };

export interface GuiMessage {
  id: string;
  role: "user" | "assistant";
  blocks: GuiBlock[];
  /** Epoch ms. For history entries this is the transcript timestamp, not the load time. */
  ts: number;
}

export interface GuiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** How full the model's context window is right now, straight from the CLI's own accounting
 *  (`Query.getContextUsage()`) — never estimated from token counts on this side. */
export interface GuiContextUsage {
  usedTokens: number;
  maxTokens: number;
  /** 0–100, as the CLI reports it. */
  percentage: number;
  /** True when the CLI will compact on its own before the window runs out. */
  autoCompact: boolean;
}

/** A tool the agent wants to run that needs an explicit yes. Mirrors the SDK's canUseTool payload. */
export interface GuiApprovalRequest {
  id: string;
  toolName: string;
  input: unknown;
  /** True when the SDK offered permission suggestions, i.e. "allow for the rest of this session"
   *  is a meaningful choice rather than a duplicate of a plain allow. */
  canAllowForSession: boolean;
}

export type GuiApprovalDecision = "allow" | "allowForSession" | "deny";

/** One question from the AskUserQuestion tool. `id` is the question text verbatim — the SDK looks
 *  answers up by text, so it must not be shortened or normalised. */
export interface GuiQuestion {
  id: string;
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

export interface GuiQuestionRequest {
  id: string;
  questions: GuiQuestion[];
}

export type GuiTurnStatus = "completed" | "interrupted" | "failed";

/** What "undo file changes" on a rewind would do to the working tree, asked for before the user
 *  commits to it — the undo deletes files created since that message, so the count goes in front of
 *  them first. `available: false` means no workspace snapshot covers that message, so the numbers
 *  are unknown (the agent's own per-file backups may still revert something). */
export interface GuiRewindPreview {
  /** Echoed back so the chat can match the answer to the message that asked. */
  userTurnsAfter: number;
  available: boolean;
  files: number;
  insertions: number;
  deletions: number;
  /** Files that would be deleted outright — the destructive half. */
  removed: number;
  reason?: string;
}

/** Everything the server pushes about a live session. Ordered, never replayed — the initial
 *  transcript arrives once as a `history` frame instead. */
export type GuiEvent =
  | { type: "message.start"; id: string; role: "user" | "assistant"; ts: number }
  | { type: "message.end"; id: string }
  | { type: "block.start"; messageId: string; block: GuiBlock }
  | { type: "block.delta"; messageId: string; blockId: string; text: string }
  | { type: "block.end"; messageId: string; blockId: string }
  | { type: "block.input"; messageId: string; blockId: string; input: unknown }
  | { type: "tool.result"; toolUseId: string; status: Exclude<GuiToolStatus, "running">; result: string }
  // `startedAt` is when the SERVER opened the turn, not when this client heard about it — a client
  // that reconnects (or a chat that is closed and reopened) is replayed the original stamp, so the
  // elapsed clock keeps counting the turn instead of restarting from zero.
  | { type: "turn.start"; turnId: string; startedAt: number }
  | { type: "turn.end"; turnId: string; status: GuiTurnStatus; usage?: GuiUsage; costUsd?: number }
  | { type: "approval.request"; request: GuiApprovalRequest }
  | { type: "approval.resolved"; id: string; decision: GuiApprovalDecision }
  | { type: "question.request"; request: GuiQuestionRequest }
  | { type: "question.resolved"; id: string }
  | { type: "plan.proposed"; text: string }
  | { type: "session"; sessionId: string }
  /** The conversation was cut back to an earlier turn (edit/delete). Replaces the whole transcript
   *  rather than describing a diff — a rewind can drop any amount of it. */
  | { type: "history.reset"; messages: GuiMessage[] }
  | { type: "state"; state: GuiSessionState }
  | { type: "config"; config: GuiConfig }
  | { type: "error"; message: string }
  /** Something worth telling the user that isn't a failure — e.g. how many files a rewind reverted.
   *  Liveness, not transcript: it is never replayed to a reconnecting client. */
  | { type: "notice"; message: string }
  /** Context-window occupancy, pushed after every turn and once on connect. */
  | { type: "context"; usage: GuiContextUsage }
  /** Answer to a `rewind.preview` request. Liveness, never replayed. */
  | { type: "rewind.preview"; preview: GuiRewindPreview }
  /** The outcome of a rewind the client asked for. Sent for BOTH outcomes: a refusal has to reach the
   *  editor that asked, or it closes over text the user typed and that text is gone. */
  | { type: "rewind.result"; ok: boolean; error?: string };

// ---------------------------------------------------------------------------
// Composer controls — the model / reasoning / permission pills
// ---------------------------------------------------------------------------

/** One row of the model picker, distilled from the CLI's own `Query.supportedModels()`. Never
 *  hardcoded: whatever Claude Code ships is what the picker offers. */
export interface GuiModel {
  /** The id passed to `--model`, e.g. `"default"`, `"sonnet"`, `"claude-fable-5[1m]"`. */
  value: string;
  displayName: string;
  description: string;
  supportsEffort: boolean;
  /** Exactly the levels this model accepts — the picker greys out everything else. */
  effortLevels: GuiEffortLevel[];
  /** The level this model lands on when no effort is chosen, so the menu can say which row you
   *  already have. Per-model — Codex reports its own, and they differ between models. */
  defaultEffort: GuiEffortLevel | null;
  supportsFastMode: boolean;
  /** True when the CLI lists this model in its 1M-context form, which is the only evidence that a
   *  200k/1M toggle is real for it. Derived from `value`, never assumed. */
  supportsContext1m: boolean;
  /** `value` with any `[1m]` suffix removed — the 200k form, and the identity shared by both. */
  base: string;
  /** The row the CLI runs when no model is named. Claude publishes it as a catalog row literally
   *  called "default"; Codex flags one of its real models instead. Either way the picker needs to
   *  know which row an unset model actually lands on, or it can't show its options. */
  isDefault: boolean;
}

/** The subset of GuiEffort that is a real, model-advertised effort level. `ultra` is Codex-only —
 *  which levels a given model offers comes from that model's own catalog row, not from this union. */
export type GuiEffortLevel = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

// ---------------------------------------------------------------------------
// WebSocket frames — /ws/gui/:terminalId
// ---------------------------------------------------------------------------

/** One image attached to a prompt. */
export interface GuiImageAttachment {
  /** image/png, image/jpeg, image/gif or image/webp — the four the API accepts. */
  mediaType: string;
  dataBase64: string;
}

/** A slash command the installed CLI offers, straight from `Query.supportedCommands()`. */
export interface GuiCommand {
  name: string;
  description: string;
  argumentHint: string;
}

export type GuiClientFrame =
  | { type: "prompt"; text: string; images?: GuiImageAttachment[] }
  | { type: "interrupt" }
  | { type: "approve"; id: string; decision: GuiApprovalDecision }
  | { type: "answer"; id: string; answers: Record<string, string[]> }
  /** Cut the conversation back to a user turn, identified by how many user turns follow it.
   *  `newText` re-sends that turn with different wording (edit); omitting it just drops the turn
   *  and everything after it (delete). */
  | { type: "rewind"; userTurnsAfter: number; text: string; newText?: string; restoreFiles?: boolean }
  /** Ask what undoing the file changes at that turn would cost, without doing anything. */
  | { type: "rewind.preview"; userTurnsAfter: number; text: string }
  | { type: "ping" };

export type GuiServerFrame =
  /** `agent` rides along so the composer can label itself and drop the pills that mean nothing for
   *  the CLI behind this chat. It cannot change without the socket reconnecting. */
  | { type: "history"; messages: GuiMessage[]; sessionId: string | null; config: GuiConfig; agent: GuiAgent }
  | { type: "event"; event: GuiEvent }
  | { type: "pong" };
