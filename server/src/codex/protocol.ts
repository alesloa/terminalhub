// The slice of the `codex app-server` v2 protocol the GUI chat actually uses.
//
// Hand-written on purpose. The full generated bindings are ~43k lines covering plugins, realtime
// audio, cloud tasks and Windows sandbox setup; none of that is reachable from a chat pane, and
// vendoring it would put a second, larger protocol surface in this repo than the app itself.
// Everything here was read off `codex app-server generate-json-schema` for codex-cli 0.147.0 and
// confirmed against a live server — see server/src/gui/codex/normalize.ts for the mapping.
//
// Unknown fields are simply absent from these types; the transport never validates, so a newer CLI
// adding members is a no-op rather than a crash. Unknown *variants* fall through the switches.

/** Methods we call. */
export const CODEX_METHOD = {
  initialize: "initialize",
  initialized: "initialized",
  threadStart: "thread/start",
  threadResume: "thread/resume",
  threadRead: "thread/read",
  /** Drops N whole turns off the end of a thread. Codex's own note: it rewrites the conversation
   *  only — reverting the working tree is the client's job (we use the git checkpoints for that). */
  threadRollback: "thread/rollback",
  skillsList: "skills/list",
  turnStart: "turn/start",
  turnSteer: "turn/steer",
  turnInterrupt: "turn/interrupt",
  modelList: "model/list",
} as const;

/** Server→client requests we answer. Anything else is refused with "method not found". */
export const CODEX_SERVER_REQUEST = {
  commandApproval: "item/commandExecution/requestApproval",
  fileChangeApproval: "item/fileChange/requestApproval",
  requestUserInput: "item/tool/requestUserInput",
} as const;

/** Server→client notifications we fold into the transcript. */
export const CODEX_NOTIFICATION = {
  threadStarted: "thread/started",
  turnStarted: "turn/started",
  turnCompleted: "turn/completed",
  itemStarted: "item/started",
  itemCompleted: "item/completed",
  agentMessageDelta: "item/agentMessage/delta",
  reasoningTextDelta: "item/reasoning/textDelta",
  reasoningSummaryTextDelta: "item/reasoning/summaryTextDelta",
  commandOutputDelta: "item/commandExecution/outputDelta",
  tokenUsage: "thread/tokenUsage/updated",
  error: "error",
} as const;

// ---------------------------------------------------------------------------
// Requests / responses
// ---------------------------------------------------------------------------

export interface CodexInitializeResponse {
  userAgent: string;
  codexHome: string;
}

/** `read-only` | `workspace-write` | `danger-full-access`. */
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
/** `untrusted` asks about everything, `on-request` lets the agent escalate, `never` never asks. */
export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";

export interface CodexThreadStartParams {
  cwd: string;
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
  model?: string;
}

export interface CodexThreadResumeParams extends Partial<CodexThreadStartParams> {
  threadId: string;
}

export interface CodexThread {
  id: string;
  cwd: string;
  /** Only populated by resume/read/fork/rollback; empty everywhere else. */
  turns: CodexTurn[];
}

export interface CodexThreadResponse {
  thread: CodexThread;
  model: string;
  /** The effort the thread actually starts under, when the server reports one. */
  reasoningEffort?: string | null;
}

export type CodexTurnStatus = "inProgress" | "completed" | "interrupted" | "failed";

export interface CodexTurn {
  id: string;
  items: CodexItem[];
  status: CodexTurnStatus;
  error?: { message?: string } | null;
}

/** One user input part. Codex takes images as `url` (a data: URI is accepted) or a local `path`. */
export type CodexUserInput =
  | { type: "text"; text: string }
  | { type: "image"; url: string };

export interface CodexTurnStartParams {
  threadId: string;
  input: CodexUserInput[];
  model?: string;
  effort?: string;
  approvalPolicy?: CodexApprovalPolicy;
}

/** Steering an in-flight turn — the same input, delivered to the turn already running. */
export interface CodexTurnSteerParams {
  threadId: string;
  expectedTurnId: string;
  input: CodexUserInput[];
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  inputModalities?: string[];
}

export interface CodexModelListResponse { data: CodexModel[] }

// ---------------------------------------------------------------------------
// Thread items — the units a turn is built from
// ---------------------------------------------------------------------------

export type CodexItemStatus = "inProgress" | "completed" | "failed" | "declined";

export interface CodexUserMessageItem {
  type: "userMessage";
  id: string;
  content: { type: string; text?: string; url?: string }[];
}

export interface CodexAgentMessageItem {
  type: "agentMessage";
  id: string;
  text: string;
}

export interface CodexReasoningItem {
  type: "reasoning";
  id: string;
  /** Full reasoning text, when the model exposes it. */
  content: string[];
  /** The short public summary — what the CLI prints. */
  summary: string[];
}

export interface CodexPlanItem {
  type: "plan";
  id: string;
  text: string;
}

export interface CodexCommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  cwd?: string | null;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  status: CodexItemStatus;
}

export interface CodexFileChangeItem {
  type: "fileChange";
  id: string;
  changes: { path: string; kind: string; diff: string }[];
  status: CodexItemStatus;
}

export interface CodexMcpToolCallItem {
  type: "mcpToolCall";
  id: string;
  server: string;
  tool: string;
  arguments?: unknown;
  status: CodexItemStatus;
  result?: unknown;
  error?: { message?: string } | null;
}

export interface CodexDynamicToolCallItem {
  type: "dynamicToolCall";
  id: string;
  tool: string;
  namespace?: string | null;
  arguments?: unknown;
  status: CodexItemStatus;
  success?: boolean | null;
  contentItems?: { type?: string; text?: string }[] | null;
}

export interface CodexWebSearchItem {
  type: "webSearch";
  id: string;
  query: string;
}

export interface CodexImageViewItem {
  type: "imageView";
  id: string;
  path: string;
}

/** Anything the switches don't recognise. Kept so a newer CLI's item is ignored, not fatal. */
export interface CodexUnknownItem { type: string; id: string }

export type CodexItem =
  | CodexUserMessageItem
  | CodexAgentMessageItem
  | CodexReasoningItem
  | CodexPlanItem
  | CodexCommandExecutionItem
  | CodexFileChangeItem
  | CodexMcpToolCallItem
  | CodexDynamicToolCallItem
  | CodexWebSearchItem
  | CodexImageViewItem
  | CodexUnknownItem;

// ---------------------------------------------------------------------------
// Notification payloads
// ---------------------------------------------------------------------------

export interface CodexItemNotification { item: CodexItem; threadId: string; turnId: string }
export interface CodexTurnNotification { threadId: string; turn: CodexTurn }
export interface CodexThreadNotification { thread: CodexThread }
export interface CodexDeltaNotification { itemId: string; delta: string; threadId: string; turnId: string }
export interface CodexErrorNotification {
  threadId: string;
  turnId: string;
  willRetry: boolean;
  error: { message?: string } | null;
}

export interface CodexTokenUsageNotification {
  threadId: string;
  turnId: string;
  tokenUsage: {
    total: { totalTokens: number; inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number };
    last?: { totalTokens: number };
    modelContextWindow?: number | null;
  };
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

/** `accept` runs it once, `acceptForSession` stops asking, `decline` refuses but lets the turn go
 *  on, `cancel` refuses AND interrupts. Shared by both approval kinds. */
export type CodexApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface CodexCommandApprovalParams {
  itemId: string;
  threadId: string;
  turnId: string;
  command?: string | null;
  cwd?: string | null;
  reason?: string | null;
}

export interface CodexFileChangeApprovalParams {
  itemId: string;
  threadId: string;
  turnId: string;
  reason?: string | null;
  grantRoot?: string | null;
}

export interface CodexUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options?: { label: string; description: string }[] | null;
  isOther?: boolean;
  isSecret?: boolean;
}

export interface CodexRequestUserInputParams {
  itemId: string;
  threadId: string;
  turnId: string;
  isBlocking: boolean;
  questions: CodexUserInputQuestion[];
}
