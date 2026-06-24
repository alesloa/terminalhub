import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getClaudeSessions, getCodexSessions, resetCodexCache } from "./discover.js";
import { createClaudeController } from "./controller.js";
import { projectPathToFolderName } from "./paths.js";

const PROJECT = "/work/myproj";
let home: string;
let realHome: string | undefined;

function claudeDir(): string {
  return path.join(home, ".claude", "projects", projectPathToFolderName(PROJECT));
}

function userLine(text: string): string {
  return JSON.stringify({ type: "user", message: { content: text }, timestamp: "2026-06-08T00:00:00.000Z" });
}

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-claude-"));
  process.env.HOME = home;
  resetCodexCache();
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

describe("getClaudeSessions", () => {
  it("discovers .jsonl files on disk and resolves titles via the index", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "aaaa1111-2222-3333-4444-555566667777.jsonl"), userLine("first prompt here") + "\n");
    writeFileSync(path.join(dir, "sessions-index.json"), JSON.stringify({
      version: 1, originalPath: PROJECT, entries: [{
        sessionId: "aaaa1111-2222-3333-4444-555566667777",
        fullPath: path.join(dir, "aaaa1111-2222-3333-4444-555566667777.jsonl"),
        firstPrompt: "indexed title", messageCount: 5, created: "2026-06-08T00:00:00.000Z",
        modified: "2026-06-08T00:00:00.000Z", gitBranch: "main", projectPath: PROJECT, isSidechain: false,
      }],
    }));

    const sessions = await getClaudeSessions(PROJECT);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("indexed title");
    expect(sessions[0].messageCount).toBe(5);
    expect(sessions[0].gitBranch).toBe("main");
  });

  it("applies a custom name from session-names.json over the index title", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const sid = "bbbb1111-2222-3333-4444-555566667777";
    writeFileSync(path.join(dir, `${sid}.jsonl`), userLine("hello") + "\n");
    writeFileSync(path.join(dir, "session-names.json"), JSON.stringify({ names: { [sid]: "My Renamed Session" } }));

    const sessions = await getClaudeSessions(PROJECT);
    expect(sessions[0].title).toBe("My Renamed Session");
  });

  it("falls back to the first user message when there's no index entry", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const sid = "cccc1111-2222-3333-4444-555566667777";
    writeFileSync(path.join(dir, `${sid}.jsonl`), userLine("derive me from the transcript") + "\n");

    const sessions = await getClaudeSessions(PROJECT);
    expect(sessions[0].title).toBe("derive me from the transcript");
  });

  it("skips sidechain sessions listed in the index", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const sid = "dddd1111-2222-3333-4444-555566667777";
    writeFileSync(path.join(dir, `${sid}.jsonl`), userLine("sidechain") + "\n");
    writeFileSync(path.join(dir, "sessions-index.json"), JSON.stringify({
      version: 1, originalPath: PROJECT, entries: [{
        sessionId: sid, fullPath: path.join(dir, `${sid}.jsonl`), firstPrompt: "x", messageCount: 1,
        created: "", modified: "", gitBranch: "", projectPath: PROJECT, isSidechain: true,
      }],
    }));

    expect(await getClaudeSessions(PROJECT)).toHaveLength(0);
  });

  it("returns [] when the project has no Claude directory", async () => {
    expect(await getClaudeSessions(PROJECT)).toEqual([]);
  });
});

describe("getCodexSessions", () => {
  it("matches sessions by recorded cwd", async () => {
    const dir = path.join(home, ".codex", "sessions", "2026", "06", "08");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "rollout-2026-06-08-eeee1111-2222-3333-4444-555566667777.jsonl");
    writeFileSync(file, [
      JSON.stringify({ type: "session_meta", payload: { cwd: PROJECT } }),
      JSON.stringify({ type: "response_item", payload: { role: "user", content: [{ type: "input_text", input_text: "hi codex" }] } }),
    ].join("\n") + "\n");

    const sessions = await getCodexSessions(PROJECT);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentType).toBe("codex");
    expect(sessions[0].id).toBe("eeee1111-2222-3333-4444-555566667777");
  });

  it("ignores sessions whose cwd is a different project", async () => {
    const dir = path.join(home, ".codex", "sessions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "rollout-x-ffff1111-2222-3333-4444-555566667777.jsonl"),
      JSON.stringify({ type: "session_meta", payload: { cwd: "/some/other/place" } }) + "\n");

    expect(await getCodexSessions(PROJECT)).toHaveLength(0);
  });
});

describe("controller.listSessions", () => {
  it("flags a session as running when a live PID file points at it", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const sid = "9999aaaa-2222-3333-4444-555566667777";
    writeFileSync(path.join(dir, `${sid}.jsonl`), userLine("running one") + "\n");

    const sessDir = path.join(home, ".claude", "sessions");
    mkdirSync(sessDir, { recursive: true });
    // this test process is definitely alive → isRunning must be true
    writeFileSync(path.join(sessDir, `${sid}.json`), JSON.stringify({ pid: process.pid, sessionId: sid, cwd: PROJECT, startedAt: "" }));

    const { claude } = await createClaudeController().listSessions(PROJECT);
    expect(claude.find((s) => s.id === sid)?.isRunning).toBe(true);
  });
});
