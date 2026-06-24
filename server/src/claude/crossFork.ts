import { randomUUID, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentType, Session } from "./types.js";
import { codexSessionsDir, claudeProjectDir, codexIndexPath } from "./paths.js";
import { setCustomName } from "./names.js";
import { addToSessionsIndex } from "./indexFiles.js";

// Cross-CLI fork: translate a session from one CLI's on-disk format to the other.
// The intermediate representation is just {role, text} — tool calls, system prompts, and
// attachments are dropped on purpose (matches the extension/Zed behavior). Ported faithfully
// from claude-session-explorer/src/services/crossCliForkService.ts.

export interface ConvertedMessage {
  role: "user" | "assistant";
  text: string;
}

export type TargetCli = "claude" | "codex";

export interface CrossForkResult {
  newSessionId: string;
  targetCli: TargetCli;
  newFilePath: string;
  messageCount: number;
  forkedTitle: string;
}

// --- Extraction ---

// Markers the CLIs inject into "user" turns that are really system noise, not the human.
// Deliberately NARROWER than jsonl.ts's SYSTEM_MARKERS: it omits "SKILL.md" on purpose, matching
// the extension's crossCliForkService. Cross-fork preserves the real human conversation, and
// "SKILL.md" as a bare substring would wrongly drop genuine user turns that just mention the file.
const SYSTEM_MARKERS = ["<system-reminder>", "<environment_context>", "<INSTRUCTIONS>"];

/**
 * Parse a Claude JSONL string and extract only user/assistant text messages. Skips tool calls,
 * system-injected reminders, and everything else, then normalizes to strict alternation.
 */
export function extractClaudeTextMessages(content: string): ConvertedMessage[] {
  const raw: ConvertedMessage[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const type = obj.type as string | undefined;
    if (type !== "user" && type !== "assistant") continue;

    const message = obj.message as Record<string, unknown> | undefined;
    const msgContent = message?.content;
    if (msgContent == null) continue;

    let text = "";
    if (typeof msgContent === "string") {
      text = msgContent;
    } else if (Array.isArray(msgContent)) {
      text = msgContent
        .filter((b: Record<string, unknown>) => b.type === "text" && typeof b.text === "string")
        .map((b: Record<string, unknown>) => b.text as string)
        .join("\n");
    }
    if (!text.trim()) continue;

    // Skip system-injected user messages (reminders, env context, etc.).
    if (type === "user" && SYSTEM_MARKERS.some((m) => text.includes(m))) continue;

    raw.push({ role: type, text });
  }

  return normalizeMessages(raw);
}

/**
 * Parse a Codex JSONL string and extract only user/assistant text messages. Only `response_item`
 * lines with input_text/output_text blocks are kept. Codex writes multiple response_item lines
 * per turn, so raw extraction produces same-role runs; normalizeMessages collapses them.
 */
export function extractCodexTextMessages(content: string): ConvertedMessage[] {
  const raw: ConvertedMessage[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type !== "response_item") continue;
    const payload = obj.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    const role = payload.role as string | undefined;
    if (role !== "user" && role !== "assistant") continue;

    const payloadContent = payload.content;
    if (!Array.isArray(payloadContent)) continue;

    const text = payloadContent
      .filter(
        (b: Record<string, unknown>) =>
          (b.type === "input_text" || b.type === "output_text") && typeof b.text === "string",
      )
      .map((b: Record<string, unknown>) => b.text as string)
      .join("\n");

    if (!text.trim()) continue;
    raw.push({ role, text });
  }

  return normalizeMessages(raw);
}

/**
 * Collapse consecutive same-role messages into one and drop leading assistants. Ensures the
 * output is a strict user→assistant alternation starting with a user message — the only structure
 * either CLI accepts when resuming a session from disk.
 */
export function normalizeMessages(messages: ConvertedMessage[]): ConvertedMessage[] {
  // Drop leading assistant messages — a conversation must start with user.
  let firstUser = 0;
  while (firstUser < messages.length && messages[firstUser].role !== "user") firstUser++;
  const trimmed = messages.slice(firstUser);

  // Collapse consecutive same-role messages by concatenating their text.
  const collapsed: ConvertedMessage[] = [];
  for (const msg of trimmed) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.role === msg.role) prev.text += "\n\n" + msg.text;
    else collapsed.push({ ...msg });
  }
  return collapsed;
}

// --- Serialization ---

// Claude's on-disk format needs many more fields than the intermediate spec covers. These match
// real Claude Code 2.1.x session files verified on disk by the extension.
const CLAUDE_VERSION = "2.1.90";
const CLAUDE_DEFAULT_MODEL = "claude-opus-4-6";

/** Claude-style message id: `msg_` + 24 alphanumeric chars. */
function generateMsgId(): string {
  return "msg_" + randomBytes(18).toString("base64url").slice(0, 24);
}

/** Claude-style request id: `req_` + 24 alphanumeric chars. */
function generateReqId(): string {
  return "req_" + randomBytes(18).toString("base64url").slice(0, 24);
}

export function messagesToClaudeJsonl(
  messages: ConvertedMessage[],
  sessionId: string,
  projectPath: string,
): string {
  const lines: string[] = [];
  // First line's parentUuid is empty string per Claude's on-disk format.
  let parentUuid = "";
  const timestamp = new Date().toISOString();

  for (const msg of messages) {
    const uuid = randomUUID();

    let obj: Record<string, unknown>;
    if (msg.role === "user") {
      // User lines need promptId, permissionMode, userType, entrypoint, version, gitBranch, slug
      // — otherwise Claude CLI skips them on resume.
      obj = {
        parentUuid,
        isSidechain: false,
        promptId: randomUUID(),
        type: "user",
        message: { role: "user", content: msg.text },
        uuid,
        timestamp,
        permissionMode: "default",
        userType: "external",
        entrypoint: "cli",
        cwd: projectPath,
        sessionId,
        version: CLAUDE_VERSION,
        gitBranch: "",
        slug: "cross-cli-fork",
      };
    } else {
      // Assistant lines need a rich message object with id/model/type/usage or Claude's context
      // accounting skips the line entirely.
      obj = {
        parentUuid,
        isSidechain: false,
        message: {
          id: generateMsgId(),
          type: "message",
          role: "assistant",
          model: CLAUDE_DEFAULT_MODEL,
          content: [{ type: "text", text: msg.text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          stop_details: null,
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
            service_tier: "standard",
          },
        },
        requestId: generateReqId(),
        type: "assistant",
        uuid,
        timestamp,
        userType: "external",
        entrypoint: "cli",
        cwd: projectPath,
        sessionId,
        version: CLAUDE_VERSION,
        gitBranch: "",
        slug: "cross-cli-fork",
      };
    }

    lines.push(JSON.stringify(obj));
    parentUuid = uuid;
  }

  return lines.join("\n") + "\n";
}

/**
 * Serialize messages to Codex's JSONL format. Writes a session_meta header, then groups
 * user→assistant pairs into "turns" with the ceremonial event wrapping Codex CLI expects on
 * resume.
 */
export function messagesToCodexJsonl(
  messages: ConvertedMessage[],
  sessionId: string,
  projectPath: string,
): string {
  const lines: string[] = [];
  const sessionTs = new Date().toISOString();

  // session_meta — header, written once at the top of the file.
  lines.push(
    JSON.stringify({
      timestamp: sessionTs,
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: sessionTs,
        cwd: projectPath,
        originator: "terminalhub",
        cli_version: "0.0.0",
        source: "terminalhub",
        model_provider: "openai",
      },
    }),
  );

  // Walk messages pairwise — each user→assistant pair becomes one "turn".
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const turnId = randomUUID();
    const turnTs = new Date().toISOString();

    if (msg.role === "user") {
      lines.push(
        JSON.stringify({
          timestamp: turnTs,
          type: "event_msg",
          payload: {
            type: "task_started",
            turn_id: turnId,
            model_context_window: 200000,
            collaboration_mode_kind: "default",
          },
        }),
      );
      lines.push(
        JSON.stringify({
          timestamp: turnTs,
          type: "turn_context",
          payload: { turn_id: turnId, cwd: projectPath },
        }),
      );
      lines.push(
        JSON.stringify({
          timestamp: turnTs,
          type: "response_item",
          payload: { type: "message", role: "user", content: [{ type: "input_text", text: msg.text }] },
        }),
      );
      lines.push(
        JSON.stringify({
          timestamp: turnTs,
          type: "event_msg",
          payload: {
            type: "user_message",
            message: msg.text,
            images: [],
            local_images: [],
            text_elements: [],
          },
        }),
      );

      const next = messages[i + 1];
      if (next && next.role === "assistant") {
        lines.push(
          JSON.stringify({
            timestamp: turnTs,
            type: "event_msg",
            payload: { type: "agent_message", message: next.text, phase: "final_answer" },
          }),
        );
        lines.push(
          JSON.stringify({
            timestamp: turnTs,
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: next.text }],
            },
          }),
        );
        lines.push(
          JSON.stringify({
            timestamp: turnTs,
            type: "event_msg",
            payload: { type: "task_complete", turn_id: turnId, last_agent_message: next.text },
          }),
        );
        i++; // consumed the assistant we just paired
      } else {
        lines.push(
          JSON.stringify({
            timestamp: turnTs,
            type: "event_msg",
            payload: { type: "task_complete", turn_id: turnId },
          }),
        );
      }
    } else {
      // Orphan assistant — emit a bare response_item with type:"message".
      lines.push(
        JSON.stringify({
          timestamp: turnTs,
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: msg.text }],
          },
        }),
      );
    }
  }

  return lines.join("\n") + "\n";
}

// --- Orchestrator ---

/**
 * Fork a session to the other CLI. Reads the source file, extracts messages into the intermediate
 * format, serializes to the target format, and writes to the correct directory with CLI-specific
 * registration (index files + custom name). Throws "session has no messages" if extraction yields
 * nothing.
 */
export async function forkToOtherCli(session: Session): Promise<CrossForkResult> {
  const newSessionId = randomUUID();
  const sourceContent = await fs.readFile(session.jsonlPath, "utf-8");
  const forkedTitle = `${session.title} (forked)`;

  if (session.agentType === "claude") {
    // Claude → Codex
    const messages = extractClaudeTextMessages(sourceContent);
    if (messages.length === 0) throw new Error("session has no messages");
    const codexJsonl = messagesToCodexJsonl(messages, newSessionId, session.projectPath);

    // Codex organizes transcripts by YYYY/MM/DD.
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const codexDir = path.join(codexSessionsDir(), yyyy, mm, dd);
    await fs.mkdir(codexDir, { recursive: true });

    // Filename: rollout-<timestamp>-<uuid>.jsonl
    const tsSafe = now.toISOString().replace(/\..*/, "").replace(/:/g, "-");
    const newFilePath = path.join(codexDir, `rollout-${tsSafe}-${newSessionId}.jsonl`);
    await fs.writeFile(newFilePath, codexJsonl, "utf-8");

    // Append to ~/.codex/session_index.jsonl
    const indexPath = codexIndexPath();
    await fs.appendFile(
      indexPath,
      JSON.stringify({ id: newSessionId, thread_name: forkedTitle, updated_at: now.toISOString() }) + "\n",
      "utf-8",
    );

    // Custom name is stored at the codex sessions root, not the dated subdir.
    await setCustomName(codexSessionsDir(), newSessionId, forkedTitle);

    return { newSessionId, targetCli: "codex", newFilePath, messageCount: messages.length, forkedTitle };
  }

  // Codex → Claude
  const messages = extractCodexTextMessages(sourceContent);
  if (messages.length === 0) throw new Error("session has no messages");
  const claudeJsonl = messagesToClaudeJsonl(messages, newSessionId, session.projectPath);

  const claudeDir = claudeProjectDir(session.projectPath);
  await fs.mkdir(claudeDir, { recursive: true });

  const newFilePath = path.join(claudeDir, `${newSessionId}.jsonl`);
  await fs.writeFile(newFilePath, claudeJsonl, "utf-8");

  await setCustomName(claudeDir, newSessionId, forkedTitle);

  // Add to sessions-index.json if it exists (no-op if missing).
  await addToSessionsIndex(claudeDir, {
    sessionId: newSessionId,
    fullPath: newFilePath,
    projectPath: session.projectPath,
    firstPrompt: messages.find((m) => m.role === "user")?.text,
  });

  return { newSessionId, targetCli: "claude", newFilePath, messageCount: messages.length, forkedTitle };
}
