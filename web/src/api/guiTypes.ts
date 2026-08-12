// Web mirror of server/src/gui/types.ts — the GUI-mode chat contract. Hand-kept in sync, the same
// way web/src/api/types.ts mirrors server/src/types.ts. Nothing here is validated at runtime; the
// server is the authority on shape.

export type GuiSessionState = "idle" | "starting" | "running" | "waiting" | "stopped" | "error";

/** `aborted` = the run ended before the call reported back (interrupt, crash, hub restart). It is
 *  not a failure — nothing came back either way — so it must not read as one. */
export type GuiToolStatus = "running" | "ok" | "error" | "aborted";

export type GuiBlock =
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  /** An image the user attached to their turn, held as the base64 that was sent to the model. */
  | { kind: "image"; id: string; mediaType: string; dataBase64: string }
  | {
      kind: "tool";
      id: string;
      toolUseId: string;
      name: string;
      input: unknown;
      status: GuiToolStatus;
      result?: string;
    };

export interface GuiMessage {
  id: string;
  role: "user" | "assistant";
  blocks: GuiBlock[];
  ts: number;
}

export interface GuiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface GuiApprovalRequest {
  id: string;
  toolName: string;
  input: unknown;
  canAllowForSession: boolean;
}

export type GuiApprovalDecision = "allow" | "allowForSession" | "deny";

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

// ---------------------------------------------------------------------------
// Composer controls — the model / reasoning / permission pills
// ---------------------------------------------------------------------------

/** Reasoning depth. The first five are real SDK effort levels; `ultracode` and `ultrathink` are
 *  Claude Code concepts the server translates onto other channels — from here they are ordinary
 *  `effort` values, so the composer never rewrites the prompt to express one. */
export type GuiEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode" | "ultrathink";

/** The subset of GuiEffort a model can actually list in `effortLevels`. */
export type GuiEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

/** How much the agent may do before it has to ask. */
export type GuiPermissionMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";

export interface GuiConfig {
  /** A `value` from the model catalog. null = no `--model`, the CLI picks. */
  model: string | null;
  /** null = no `--effort`, the model decides. */
  effort: GuiEffort | null;
  permissionMode: GuiPermissionMode;
  fastMode: boolean;
}

/** One row of the model picker, distilled server-side from the installed CLI's own model list. Never
 *  hardcoded here: whatever Claude Code ships is what the picker offers. */
export interface GuiModel {
  value: string;
  displayName: string;
  description: string;
  supportsEffort: boolean;
  /** Exactly the levels this model accepts — the picker offers nothing else. */
  effortLevels: GuiEffortLevel[];
  supportsFastMode: boolean;
  supportsContext1m: boolean;
  /** `value` with any `[1m]` suffix removed — the 200k form, and the identity shared by both. */
  base: string;
}

export type GuiEvent =
  | { type: "message.start"; id: string; role: "user" | "assistant"; ts: number }
  | { type: "message.end"; id: string }
  | { type: "block.start"; messageId: string; block: GuiBlock }
  | { type: "block.delta"; messageId: string; blockId: string; text: string }
  | { type: "block.end"; messageId: string; blockId: string }
  | { type: "block.input"; messageId: string; blockId: string; input: unknown }
  | { type: "tool.result"; toolUseId: string; status: Exclude<GuiToolStatus, "running">; result: string }
  | { type: "turn.start"; turnId: string }
  | { type: "turn.end"; turnId: string; status: GuiTurnStatus; usage?: GuiUsage; costUsd?: number }
  | { type: "approval.request"; request: GuiApprovalRequest }
  | { type: "approval.resolved"; id: string; decision: GuiApprovalDecision }
  | { type: "question.request"; request: GuiQuestionRequest }
  | { type: "question.resolved"; id: string }
  | { type: "plan.proposed"; text: string }
  | { type: "session"; sessionId: string }
  /** The conversation was cut back to an earlier turn (edit/delete) — replaces the transcript. */
  | { type: "history.reset"; messages: GuiMessage[] }
  | { type: "state"; state: GuiSessionState }
  | { type: "config"; config: GuiConfig }
  | { type: "error"; message: string }
  | { type: "notice"; message: string }
  | { type: "context"; usage: GuiContextUsage }
  /** Answer to a `rewind.preview` request. */
  | { type: "rewind.preview"; preview: GuiRewindPreview }
  /** The outcome of a rewind the client asked for. Sent for BOTH outcomes: a refusal has to reach the
   *  editor that asked, or it closes over text the user typed and that text is gone. */
  | { type: "rewind.result"; ok: boolean; error?: string };

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

/** How full the context window is, straight from the CLI's own accounting. */
export interface GuiContextUsage {
  usedTokens: number;
  maxTokens: number;
  percentage: number;
  autoCompact: boolean;
}

/** One image attached to a prompt. */
export interface GuiImageAttachment {
  mediaType: string;
  dataBase64: string;
}

/** A slash command the installed CLI offers. */
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
  /** Cut back to a user turn, addressed by how many user turns follow it. With `newText` the turn is
   *  re-sent reworded (edit); without it the turn and everything after it is dropped (delete). */
  | { type: "rewind"; userTurnsAfter: number; text: string; newText?: string; restoreFiles?: boolean }
  /** Ask what undoing the file changes at that turn would cost, without doing anything. */
  | { type: "rewind.preview"; userTurnsAfter: number; text: string }
  | { type: "ping" };

export type GuiServerFrame =
  | { type: "history"; messages: GuiMessage[]; sessionId: string | null; config: GuiConfig }
  | { type: "event"; event: GuiEvent }
  | { type: "pong" };

/** Response of GET /api/terminals/:id/gui. */
export interface GuiStatus {
  mode: "tmux" | "gui";
  sessionId: string | null;
  running: boolean;
  state: GuiSessionState;
  config: GuiConfig;
}
