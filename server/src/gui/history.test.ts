import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectPathToFolderName } from "../claude/paths.js";
import { loadHistory, transcriptPathFor, DEFAULT_HISTORY_LIMIT } from "./history.js";
import type { GuiBlock } from "./types.js";

const PROJECT = "/work/myproj";
let home: string;
let realHome: string | undefined;
let seq = 0;

function projectDir(): string {
  return path.join(home, ".claude", "projects", projectPathToFolderName(PROJECT));
}

/** Write a transcript and return its session id. Ids are unique per call so the parser's
 *  mtime-keyed cache can never serve one test's fixture to another. */
function writeTranscript(lines: object[]): string {
  const sid = `0000${String(++seq).padStart(4, "0")}-1111-2222-3333-444455556666`;
  mkdirSync(projectDir(), { recursive: true });
  writeFileSync(path.join(projectDir(), `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return sid;
}

let clock = 0;
function ts(): string {
  return new Date(Date.UTC(2026, 7, 10, 0, 0, clock++)).toISOString();
}

function user(content: unknown, extra: Record<string, unknown> = {}): object {
  return { type: "user", message: { role: "user", content }, timestamp: ts(), isSidechain: false, ...extra };
}

function assistant(content: unknown, extra: Record<string, unknown> = {}): object {
  return { type: "assistant", message: { role: "assistant", content }, timestamp: ts(), isSidechain: false, ...extra };
}

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-gui-history-"));
  process.env.HOME = home;
  clock = 0;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

describe("transcriptPathFor", () => {
  it("resolves a session id to its transcript inside the project folder", async () => {
    const sid = writeTranscript([user("hi")]);
    expect(await transcriptPathFor(sid, PROJECT)).toBe(path.join(projectDir(), `${sid}.jsonl`));
  });

  it("returns null when the transcript does not exist", async () => {
    expect(await transcriptPathFor("aaaabbbb-1111-2222-3333-444455556666", PROJECT)).toBeNull();
  });

  it("returns null for a session id carrying a path separator", async () => {
    mkdirSync(projectDir(), { recursive: true });
    writeFileSync(path.join(home, "escape.jsonl"), "");
    expect(await transcriptPathFor("../../escape", PROJECT)).toBeNull();
    expect(await transcriptPathFor("sub/dir", PROJECT)).toBeNull();
  });
});

describe("loadHistory — plain turns", () => {
  it("pairs user and assistant text turns in order", async () => {
    const sid = writeTranscript([
      user("what is up"),
      assistant([{ type: "text", text: "not much" }]),
      user([{ type: "text", text: "cool" }]),
      assistant([{ type: "text", text: "indeed" }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages.map((m) => (m.blocks[0] as { text: string }).text))
      .toEqual(["what is up", "not much", "cool", "indeed"]);
    expect(messages.every((m) => m.blocks.every((b) => b.kind === "text"))).toBe(true);
  });

  it("takes ts from the entry timestamp and gives every message and block a unique id", async () => {
    const sid = writeTranscript([user("first"), assistant([{ type: "text", text: "second" }])]);

    const messages = await loadHistory(sid, PROJECT);
    expect(messages[0].ts).toBe(Date.UTC(2026, 7, 10, 0, 0, 0));
    expect(messages[1].ts).toBe(Date.UTC(2026, 7, 10, 0, 0, 1));

    const ids = messages.flatMap((m) => [m.id, ...m.blocks.map((b) => b.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("renders thinking blocks alongside text, in content order", async () => {
    const sid = writeTranscript([
      user("think about it"),
      assistant([
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "text", text: "done" },
      ]),
    ]);

    const blocks = (await loadHistory(sid, PROJECT))[1].blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["thinking", "text"]);
    expect((blocks[0] as { text: string }).text).toBe("hmm");
  });

  it("drops empty text and redacted-empty thinking blocks", async () => {
    const sid = writeTranscript([
      user("go"),
      assistant([
        { type: "thinking", thinking: "", signature: "encrypted" },
        { type: "text", text: "   " },
        { type: "text", text: "kept" },
      ]),
    ]);

    const blocks = (await loadHistory(sid, PROJECT))[1].blocks;
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { text: string }).text).toBe("kept");
  });
});

describe("loadHistory — tools", () => {
  function toolBlockOf(blocks: GuiBlock[]) {
    const block = blocks.find((b) => b.kind === "tool");
    if (!block || block.kind !== "tool") throw new Error("no tool block");
    return block;
  }

  it("attaches a tool_result to its tool_use and marks it ok", async () => {
    const sid = writeTranscript([
      user("list the files"),
      assistant([
        { type: "text", text: "looking" },
        { type: "tool_use", id: "toolu_01", name: "Bash", input: { command: "ls" } },
      ]),
      user([{ type: "tool_result", tool_use_id: "toolu_01", content: "a.ts\nb.ts", is_error: false }]),
      assistant([{ type: "text", text: "two files" }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    // the tool_result entry is tooling, not a human turn — it must not become a user message
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);

    const tool = toolBlockOf(messages[1].blocks);
    expect(tool.toolUseId).toBe("toolu_01");
    expect(tool.name).toBe("Bash");
    expect(tool.input).toEqual({ command: "ls" });
    expect(tool.status).toBe("ok");
    expect(tool.result).toBe("a.ts\nb.ts");
  });

  it("marks an is_error tool_result as error", async () => {
    const sid = writeTranscript([
      user("run it"),
      assistant([{ type: "tool_use", id: "toolu_err", name: "Bash", input: { command: "false" } }]),
      user([{ type: "tool_result", tool_use_id: "toolu_err", content: "Exit code 1", is_error: true }]),
    ]);

    const tool = toolBlockOf((await loadHistory(sid, PROJECT))[1].blocks);
    expect(tool.status).toBe("error");
    expect(tool.result).toBe("Exit code 1");
  });

  it("flattens an array-shaped tool_result to its text", async () => {
    const sid = writeTranscript([
      user("read it"),
      assistant([{ type: "tool_use", id: "toolu_arr", name: "Read", input: { file_path: "/x" } }]),
      user([{
        type: "tool_result",
        tool_use_id: "toolu_arr",
        content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }],
      }]),
    ]);

    const tool = toolBlockOf((await loadHistory(sid, PROJECT))[1].blocks);
    expect(tool.status).toBe("ok");
    expect(tool.result).toBe("line one\nline two");
  });

  it("settles a tool_use with no result rather than replaying it as still running", async () => {
    const sid = writeTranscript([
      user("start"),
      assistant([{ type: "tool_use", id: "toolu_pending", name: "Bash", input: {} }]),
    ]);

    const tool = toolBlockOf((await loadHistory(sid, PROJECT))[1].blocks);
    expect(tool.status).toBe("aborted");
    expect(tool.result).toBeUndefined();
  });

  it("keeps a tool-only assistant turn even though it carries no prose", async () => {
    const sid = writeTranscript([
      user("do it"),
      assistant([{ type: "tool_use", id: "toolu_only", name: "Write", input: { file_path: "/y" } }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    expect(messages).toHaveLength(2);
    expect(messages[1].blocks.map((b) => b.kind)).toEqual(["tool"]);
  });

  it("ignores an orphan tool_result with no matching tool_use", async () => {
    const sid = writeTranscript([
      user("hello"),
      user([{ type: "tool_result", tool_use_id: "toolu_missing", content: "stray" }]),
      assistant([{ type: "text", text: "hi" }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("loadHistory — noise filtering", () => {
  it("skips system-marker user entries", async () => {
    const sid = writeTranscript([
      user("<system-reminder>do not mention this</system-reminder>"),
      user("real question"),
      user("<environment_context>cwd=/work</environment_context>"),
      assistant([{ type: "text", text: "real answer" }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect((messages[0].blocks[0] as { text: string }).text).toBe("real question");
  });

  it("skips non-conversational entry types", async () => {
    const sid = writeTranscript([
      { type: "system", subtype: "init", timestamp: ts() },
      { type: "file-history-snapshot", snapshot: {}, timestamp: ts() },
      { type: "attachment", attachment: {}, timestamp: ts() },
      user("only me"),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("skips sidechain (subagent) entries and their tool traffic", async () => {
    const sid = writeTranscript([
      user("spawn a subagent"),
      assistant([{ type: "tool_use", id: "toolu_task", name: "Task", input: { prompt: "go" } }]),
      user("subagent prompt", { isSidechain: true }),
      assistant([{ type: "text", text: "subagent narration" }], { isSidechain: true }),
      assistant([{ type: "tool_use", id: "toolu_inner", name: "Bash", input: {} }], { isSidechain: true }),
      user([{ type: "tool_result", tool_use_id: "toolu_inner", content: "inner output" }], { isSidechain: true }),
      user([{ type: "tool_result", tool_use_id: "toolu_task", content: "subagent done" }]),
      assistant([{ type: "text", text: "main thread continues" }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    const texts = messages.flatMap((m) => m.blocks.filter((b) => b.kind === "text").map((b) => (b as { text: string }).text));
    expect(texts).toEqual(["spawn a subagent", "main thread continues"]);

    const tools = messages.flatMap((m) => m.blocks.filter((b) => b.kind === "tool"));
    expect(tools).toHaveLength(1);
    expect((tools[0] as { toolUseId: string; result?: string }).toolUseId).toBe("toolu_task");
    expect((tools[0] as { result?: string }).result).toBe("subagent done");
  });
});

describe("loadHistory — limit and failure modes", () => {
  it("keeps the most recent messages when over the limit", async () => {
    const lines: object[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(user(`u${i}`));
      lines.push(assistant([{ type: "text", text: `a${i}` }]));
    }
    const sid = writeTranscript(lines);

    const messages = await loadHistory(sid, PROJECT, 3);
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => (m.blocks[0] as { text: string }).text)).toEqual(["a8", "u9", "a9"]);
  });

  it("returns everything when the transcript is shorter than the limit", async () => {
    const sid = writeTranscript([user("one"), assistant([{ type: "text", text: "two" }])]);
    expect(await loadHistory(sid, PROJECT, 50)).toHaveLength(2);
  });

  it("defaults to DEFAULT_HISTORY_LIMIT messages", async () => {
    const lines: object[] = [];
    for (let i = 0; i < DEFAULT_HISTORY_LIMIT + 5; i++) lines.push(user(`u${i}`));
    const sid = writeTranscript(lines);

    const messages = await loadHistory(sid, PROJECT);
    expect(messages).toHaveLength(DEFAULT_HISTORY_LIMIT);
    expect((messages[0].blocks[0] as { text: string }).text).toBe("u5");
  });

  it("returns [] for a session with no transcript on disk", async () => {
    expect(await loadHistory("dead0000-1111-2222-3333-444455556666", PROJECT)).toEqual([]);
  });

  it("returns [] when the project folder does not exist at all", async () => {
    expect(await loadHistory("dead0000-1111-2222-3333-444455556666", "/nope/nowhere")).toEqual([]);
  });

  it("returns [] rather than throwing on a non-positive limit", async () => {
    const sid = writeTranscript([user("hi")]);
    expect(await loadHistory(sid, PROJECT, 0)).toEqual([]);
  });

  it("skips malformed lines instead of throwing", async () => {
    mkdirSync(projectDir(), { recursive: true });
    const sid = "beef0000-1111-2222-3333-444455556666";
    writeFileSync(path.join(projectDir(), `${sid}.jsonl`), [
      JSON.stringify(user("good one")),
      "{not json at all",
      "",
      JSON.stringify(assistant([{ type: "text", text: "still here" }])),
    ].join("\n") + "\n");

    const messages = await loadHistory(sid, PROJECT);
    expect(messages.map((m) => (m.blocks[0] as { text: string }).text)).toEqual(["good one", "still here"]);
  });
});

describe("loadHistory — tool calls with no recorded result", () => {
  it("marks a trailing unresolved tool call aborted instead of leaving it running", async () => {
    // What a hub restart mid-turn writes: the tool_use is on disk, the result never was.
    const sid = writeTranscript([
      user("check the ports"),
      assistant([{ type: "tool_use", id: "toolu_hung", name: "Bash", input: { command: "lsof -nP" } }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    const block = messages.at(-1)!.blocks[0] as Extract<GuiBlock, { kind: "tool" }>;
    expect(block.status).toBe("aborted");
    expect(block.result).toBeUndefined();
  });

  it("still resolves calls whose result was written", async () => {
    const sid = writeTranscript([
      user("list files"),
      assistant([{ type: "tool_use", id: "toolu_ok", name: "Bash", input: { command: "ls" } }]),
      user([{ type: "tool_result", tool_use_id: "toolu_ok", content: "a.ts" }]),
      assistant([{ type: "tool_use", id: "toolu_open", name: "Read", input: { file_path: "/a.ts" } }]),
    ]);

    const messages = await loadHistory(sid, PROJECT);
    const done = messages[1].blocks[0] as Extract<GuiBlock, { kind: "tool" }>;
    const hung = messages.at(-1)!.blocks[0] as Extract<GuiBlock, { kind: "tool" }>;
    expect(done.status).toBe("ok");
    expect(done.result).toBe("a.ts");
    expect(hung.status).toBe("aborted");
  });
});
