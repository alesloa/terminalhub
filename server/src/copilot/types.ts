import type { AppContext } from "../context.js";
import type { CopilotSettings } from "../types.js";

// JSON Schema for a tool's input. Anthropic's `input_schema` shape; the provider adapter maps it to
// OpenAI's `function.parameters` (the same object). Kept loose — tools hand-write small schemas.
export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
};

// What a tool's `run` receives. Deliberately minimal so tools stay decoupled from the agent loop:
// the live app (store/tmux/notify/pending/pushover/scheduler), the resolved copilot settings, and
// who triggered it — 'user' (a chat turn) or 'scheduler' (a background loop, which must NOT run
// dangerous tools). Orchestration concerns (provider, history, confirm) live in the loop, not here.
export type CopilotActor = "user" | "scheduler";
export interface CopilotCtx {
  app: AppContext;
  settings: CopilotSettings;
  actor: CopilotActor;
}

// A capability the Copilot can invoke. `name` is snake_case + stable (model-facing); `description`
// tells the model WHEN to use it; `input_schema` validates args. `dangerous` tools (send keystrokes,
// launch agents, delete) are confirm-gated for users and never auto-run by the scheduler. `skillId`
// ('core' | 'email' | …) ties the tool to a skill so disabling a skill drops its tools.
export interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
  dangerous?: boolean;
  skillId: string;
  run(args: any, cctx: CopilotCtx): Promise<ToolResult>;
}
export interface ToolResult {
  ok: boolean;
  summary: string;        // one-line, model- and UI-facing ("Added card to To Do", "2 unread in Gmail")
  data?: unknown;         // structured payload fed back to the model as the tool result
}

// The registry collects tool defs and dispatches calls. `collect` filters to the enabled skills;
// the caller decides what's enabled ('core' is always passed while the copilot is on).
export interface ToolRegistry {
  register(tool: ToolDef): void;
  collect(enabledSkillIds: string[]): ToolDef[];
  get(name: string): ToolDef | undefined;
  run(name: string, args: unknown, cctx: CopilotCtx): Promise<ToolResult>;
}

// ── Canonical conversation shape ─────────────────────────────────────────────
// History is kept in Anthropic content-block form (the more expressive of the two wire formats);
// the OpenAI adapter converts to/from it. A turn's tool calls ride as `tool_use` blocks; their
// results come back as `tool_result` blocks in a following user message.
export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string };
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;
export interface CopilotMessage { role: "user" | "assistant"; content: ContentBlock[]; }

export interface ProviderToolCall { id: string; name: string; input: unknown; }

// One assistant turn, normalized: the streamed text, any tool calls, and the canonical message to
// push into history. `toolCalls.length === 0` means the model gave a final answer.
export interface AssistantTurn {
  text: string;
  toolCalls: ProviderToolCall[];
  message: CopilotMessage;
}

export interface ChatStreamRequest {
  system: string;
  messages: CopilotMessage[];
  tools: ToolDef[];
}

// The agent loop talks to the model only through this. The real adapter speaks Anthropic/OpenAI;
// tests inject a mock. `onToken` fires for each streamed text delta so the UI can render live.
export interface CopilotProvider {
  run(req: ChatStreamRequest, onToken: (delta: string) => void): Promise<AssistantTurn>;
}
