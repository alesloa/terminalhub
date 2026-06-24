import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  extractClaudeTextMessages,
  extractCodexTextMessages,
  normalizeMessages,
  messagesToClaudeJsonl,
  messagesToCodexJsonl,
  forkToOtherCli,
} from "./crossFork.js";
import { projectPathToFolderName } from "./paths.js";
import type { Session } from "./types.js";

const PROJECT = "/work/myproj";
let home: string;
let realHome: string | undefined;

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-crossfork-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

function claudeLine(type: "user" | "assistant", text: string): string {
  return JSON.stringify(
    type === "user"
      ? { type: "user", message: { role: "user", content: text } }
      : { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } },
  );
}

function codexResponseItem(role: "user" | "assistant", text: string): string {
  return JSON.stringify({
    type: "response_item",
    payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] },
  });
}

describe("extractClaudeTextMessages", () => {
  it("keeps user/assistant text, drops tool calls and system reminders", () => {
    const content = [
      claudeLine("user", "first question"),
      JSON.stringify({ type: "user", message: { content: "<system-reminder>noise</system-reminder>" } }),
      claudeLine("assistant", "an answer"),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }),
      JSON.stringify({ type: "system", message: { content: "sys" } }),
    ].join("\n");
    const msgs = extractClaudeTextMessages(content);
    expect(msgs).toEqual([
      { role: "user", text: "first question" },
      { role: "assistant", text: "an answer" },
    ]);
  });
});

describe("extractCodexTextMessages", () => {
  it("collapses same-role runs and drops leading assistants", () => {
    const content = [
      codexResponseItem("assistant", "leading reasoning"), // dropped: leading assistant
      codexResponseItem("user", "ask one"),
      codexResponseItem("assistant", "part one"),
      codexResponseItem("assistant", "part two"), // collapsed into the previous
      codexResponseItem("user", "ask two"),
    ].join("\n");
    const msgs = extractCodexTextMessages(content);
    expect(msgs).toEqual([
      { role: "user", text: "ask one" },
      { role: "assistant", text: "part one\n\npart two" },
      { role: "user", text: "ask two" },
    ]);
  });
});

describe("normalizeMessages", () => {
  it("drops leading assistant and collapses consecutive same-role", () => {
    expect(
      normalizeMessages([
        { role: "assistant", text: "a" },
        { role: "user", text: "u1" },
        { role: "user", text: "u2" },
        { role: "assistant", text: "x" },
      ]),
    ).toEqual([
      { role: "user", text: "u1\n\nu2" },
      { role: "assistant", text: "x" },
    ]);
  });
});

describe("serialization", () => {
  it("messagesToClaudeJsonl builds a parentUuid chain starting from empty string", () => {
    const jsonl = messagesToClaudeJsonl(
      [{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }],
      "sess-1",
      PROJECT,
    );
    const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("user");
    expect(lines[0].parentUuid).toBe("");
    expect(lines[0].sessionId).toBe("sess-1");
    expect(lines[1].type).toBe("assistant");
    expect(lines[1].parentUuid).toBe(lines[0].uuid); // chained
    expect(lines[1].message.content[0].text).toBe("yo");
  });

  it("messagesToCodexJsonl writes a session_meta header then a valid first user turn", () => {
    const jsonl = messagesToCodexJsonl([{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }], "sess-1", PROJECT);
    const lines = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("session_meta");
    expect(lines[0].payload.id).toBe("sess-1");
    // First response_item must be a user message.
    const firstResponseItem = lines.find((l) => l.type === "response_item");
    expect(firstResponseItem.payload.role).toBe("user");
    expect(firstResponseItem.payload.content[0].text).toBe("hi");
  });
});

describe("forkToOtherCli", () => {
  it("Claude → Codex writes a dated rollout file with a valid first user turn + index entry", async () => {
    const session: Session = {
      id: "src-claude", agentType: "claude", title: "My Session", messageCount: 2,
      created: "", modified: "", projectPath: PROJECT, isSidechain: false, isRunning: false,
      jsonlPath: path.join(home, "src.jsonl"),
    };
    writeFileSync(session.jsonlPath, [claudeLine("user", "hello there"), claudeLine("assistant", "hi back")].join("\n") + "\n");

    const result = await forkToOtherCli(session);
    expect(result.targetCli).toBe("codex");
    expect(result.messageCount).toBe(2);
    expect(result.forkedTitle).toBe("My Session (forked)");
    expect(existsSync(result.newFilePath)).toBe(true);
    expect(path.basename(result.newFilePath)).toMatch(/^rollout-.*-.+\.jsonl$/);

    // Written file: session_meta first, then a user response_item.
    const lines = readFileSync(result.newFilePath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("session_meta");
    const firstUser = lines.find((l) => l.type === "response_item");
    expect(firstUser.payload.role).toBe("user");
    expect(firstUser.payload.content[0].text).toBe("hello there");

    // session_index.jsonl got an appended entry; custom name saved at the codex sessions root.
    const indexPath = path.join(home, ".codex", "session_index.jsonl");
    const idx = readFileSync(indexPath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(idx[idx.length - 1].id).toBe(result.newSessionId);
    expect(idx[idx.length - 1].thread_name).toBe("My Session (forked)");
    const names = JSON.parse(readFileSync(path.join(home, ".codex", "sessions", "session-names.json"), "utf-8"));
    expect(names.names[result.newSessionId]).toBe("My Session (forked)");
  });

  it("Codex → Claude writes a UUID transcript with a valid first user turn under the project folder", async () => {
    const session: Session = {
      id: "src-codex", agentType: "codex", title: "Codex Run", messageCount: 2,
      created: "", modified: "", projectPath: PROJECT, isSidechain: false, isRunning: false,
      jsonlPath: path.join(home, "src-codex.jsonl"),
    };
    writeFileSync(
      session.jsonlPath,
      [codexResponseItem("user", "codex question"), codexResponseItem("assistant", "codex answer")].join("\n") + "\n",
    );

    const result = await forkToOtherCli(session);
    expect(result.targetCli).toBe("claude");
    expect(result.messageCount).toBe(2);

    const claudeDir = path.join(home, ".claude", "projects", projectPathToFolderName(PROJECT));
    expect(path.dirname(result.newFilePath)).toBe(claudeDir);
    expect(path.basename(result.newFilePath)).toBe(`${result.newSessionId}.jsonl`);

    const lines = readFileSync(result.newFilePath, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines[0].type).toBe("user");
    expect(lines[0].parentUuid).toBe(""); // valid first user turn
    expect(lines[0].message.content).toBe("codex question");
    expect(lines[0].sessionId).toBe(result.newSessionId);

    const names = JSON.parse(readFileSync(path.join(claudeDir, "session-names.json"), "utf-8"));
    expect(names.names[result.newSessionId]).toBe("Codex Run (forked)");
  });

  it("throws when the source has no user/assistant messages", async () => {
    const session: Session = {
      id: "empty", agentType: "claude", title: "Empty", messageCount: 0,
      created: "", modified: "", projectPath: PROJECT, isSidechain: false, isRunning: false,
      jsonlPath: path.join(home, "empty.jsonl"),
    };
    writeFileSync(session.jsonlPath, JSON.stringify({ type: "system", message: { content: "x" } }) + "\n");
    await expect(forkToOtherCli(session)).rejects.toThrow(/no messages/);
  });
});
