import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { projectPathToFolderName } from "../claude/paths.js";
import { resetCodexCache } from "../claude/discover.js";
import { claudeRoutes } from "./claude.js";

const PROJECT = "/work/myproj";
let home: string;
let realHome: string | undefined;
let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

function claudeDir(): string {
  return path.join(home, ".claude", "projects", projectPathToFolderName(PROJECT));
}

function assistantUsageLine(id: string): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: id,
    message: {
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 20 },
    },
    timestamp: "2026-06-08T00:00:00.000Z",
  });
}

function userLine(text: string, id: string): string {
  return JSON.stringify({ type: "user", sessionId: id, message: { content: text }, timestamp: "2026-06-08T00:00:00.000Z" });
}

beforeEach(async () => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-claude-routes-"));
  process.env.HOME = home;
  resetCodexCache();
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => claudeRoutes(a, ctx));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload });
const get = (url: string) => app.inject({ method: "GET", url });

describe("claude routes: prefs", () => {
  it("POST /api/claude/prefs upserts pin + color, GET /api/claude/sessions returns them", async () => {
    mkdirSync(claudeDir(), { recursive: true });
    const sid = "aaaa1111-2222-3333-4444-555566667777";
    writeFileSync(path.join(claudeDir(), `${sid}.jsonl`), userLine("hi", sid) + "\n");

    expect((await post("/api/claude/prefs", { sessionId: sid, pinned: true })).json()).toEqual({ ok: true });
    await post("/api/claude/prefs", { sessionId: sid, color: "#ff0000" });

    const body = (await get(`/api/claude/sessions?path=${encodeURIComponent(PROJECT)}`)).json();
    expect(body.prefs[sid]).toEqual({ pinned: true, color: "#ff0000" });
    expect(body.claude).toHaveLength(1);
    expect(Array.isArray(body.codex)).toBe(true);
  });

  it("POST /api/claude/prefs 400s on a sessionId with a path separator", async () => {
    expect((await post("/api/claude/prefs", { sessionId: "../escape", pinned: true })).statusCode).toBe(400);
  });
});

describe("claude routes: rename", () => {
  it("writes a custom name into session-names.json", async () => {
    mkdirSync(claudeDir(), { recursive: true });
    const sid = "bbbb1111-2222-3333-4444-555566667777";
    writeFileSync(path.join(claudeDir(), `${sid}.jsonl`), userLine("orig", sid) + "\n");

    expect((await post("/api/claude/rename", { agent: "claude", sessionId: sid, projectPath: PROJECT, name: "Renamed" })).json()).toEqual({ ok: true });

    const names = JSON.parse(readFileSync(path.join(claudeDir(), "session-names.json"), "utf-8"));
    expect(names.names[sid]).toBe("Renamed");
    const body = (await get(`/api/claude/sessions?path=${encodeURIComponent(PROJECT)}`)).json();
    expect(body.claude[0].title).toBe("Renamed");
  });
});

describe("claude routes: delete (cascade)", () => {
  it("deletes the session, its recursive forks, index/name/fork sidecars, and prefs", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const parent = "aaaa0000-0000-0000-0000-000000000001";
    const child = "aaaa0000-0000-0000-0000-000000000002";
    const grandchild = "aaaa0000-0000-0000-0000-000000000003";
    for (const id of [parent, child, grandchild]) {
      writeFileSync(path.join(dir, `${id}.jsonl`), userLine("x", id) + "\n");
    }
    // fork chain: parent → child → grandchild
    writeFileSync(path.join(dir, "fork-metadata.json"), JSON.stringify({
      forks: {
        [child]: { parentSessionId: parent, forkedAt: "2026-06-08T00:00:00.000Z" },
        [grandchild]: { parentSessionId: child, forkedAt: "2026-06-08T00:00:00.000Z" },
      },
    }));
    writeFileSync(path.join(dir, "session-names.json"), JSON.stringify({ names: { [parent]: "P", [child]: "C" } }));
    writeFileSync(path.join(dir, "sessions-index.json"), JSON.stringify({
      version: 1, originalPath: PROJECT, entries: [
        { sessionId: parent, fullPath: path.join(dir, `${parent}.jsonl`), firstPrompt: "P", messageCount: 1, created: "", modified: "", gitBranch: "", projectPath: PROJECT, isSidechain: false },
      ],
    }));
    // an artifact dir for the parent
    mkdirSync(path.join(dir, parent), { recursive: true });
    writeFileSync(path.join(dir, parent, "artifact.txt"), "data");

    // prefs in the DB for parent + child
    ctx.store.setClaudePref(parent, { pinned: true });
    ctx.store.setClaudePref(child, { color: "#abc" });

    const res = await post("/api/claude/delete", { agent: "claude", sessionId: parent, projectPath: PROJECT });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(new Set(body.deleted)).toEqual(new Set([parent, child, grandchild]));

    for (const id of [parent, child, grandchild]) {
      expect(existsSync(path.join(dir, `${id}.jsonl`))).toBe(false);
    }
    expect(existsSync(path.join(dir, parent))).toBe(false); // artifact dir gone
    const names = JSON.parse(readFileSync(path.join(dir, "session-names.json"), "utf-8"));
    expect(names.names[parent]).toBeUndefined();
    expect(names.names[child]).toBeUndefined();
    const index = JSON.parse(readFileSync(path.join(dir, "sessions-index.json"), "utf-8"));
    expect(index.entries.find((e: { sessionId: string }) => e.sessionId === parent)).toBeUndefined();
    const forks = JSON.parse(readFileSync(path.join(dir, "fork-metadata.json"), "utf-8"));
    expect(Object.keys(forks.forks)).toHaveLength(0);
    expect(ctx.store.getClaudePrefs()[parent]).toBeUndefined();
    expect(ctx.store.getClaudePrefs()[child]).toBeUndefined();
  });
});

describe("claude routes: fork (clone)", () => {
  it("copies the transcript to a new UUID, names it (Cloned), records the fork + index", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const sid = "cccc1111-2222-3333-4444-555566667777";
    writeFileSync(path.join(dir, `${sid}.jsonl`), userLine("clone me", sid) + "\n");
    writeFileSync(path.join(dir, "sessions-index.json"), JSON.stringify({ version: 1, originalPath: PROJECT, entries: [] }));

    const { newSessionId } = (await post("/api/claude/fork", { agent: "claude", sessionId: sid, projectPath: PROJECT })).json();
    expect(newSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(existsSync(path.join(dir, `${newSessionId}.jsonl`))).toBe(true);

    const names = JSON.parse(readFileSync(path.join(dir, "session-names.json"), "utf-8"));
    expect(names.names[newSessionId]).toContain("(Cloned)");
    const forks = JSON.parse(readFileSync(path.join(dir, "fork-metadata.json"), "utf-8"));
    expect(forks.forks[newSessionId].parentSessionId).toBe(sid);
    const index = JSON.parse(readFileSync(path.join(dir, "sessions-index.json"), "utf-8"));
    expect(index.entries.find((e: { sessionId: string }) => e.sessionId === newSessionId)).toBeTruthy();
  });

  it("404s when the session doesn't exist", async () => {
    mkdirSync(claudeDir(), { recursive: true });
    expect((await post("/api/claude/fork", { agent: "claude", sessionId: "9999dead-0000-0000-0000-000000000000", projectPath: PROJECT })).statusCode).toBe(404);
  });
});

describe("claude routes: fork-from-line", () => {
  it("truncates at the line index and rewrites the self-referenced sessionId", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const sid = "dddd1111-2222-3333-4444-555566667777";
    writeFileSync(path.join(dir, `${sid}.jsonl`), [
      userLine("line0", sid),
      assistantUsageLine(sid),
      userLine("line2", sid),
    ].join("\n") + "\n");

    const { newSessionId } = (await post("/api/claude/fork-from-line", { agent: "claude", sessionId: sid, projectPath: PROJECT, lineIndex: 1 })).json();
    const lines = readFileSync(path.join(dir, `${newSessionId}.jsonl`), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2); // kept lines 0 and 1
    for (const l of lines) {
      expect(JSON.parse(l).sessionId).toBe(newSessionId); // rewritten to the new UUID
    }
  });
});

describe("claude routes: usage", () => {
  it("totals tokens and estimates cost from assistant usage blocks", async () => {
    const dir = claudeDir();
    mkdirSync(dir, { recursive: true });
    const sid = "eeee1111-2222-3333-4444-555566667777";
    const jsonlPath = path.join(dir, `${sid}.jsonl`);
    writeFileSync(jsonlPath, [assistantUsageLine(sid), assistantUsageLine(sid)].join("\n") + "\n");

    const body = (await get(`/api/claude/usage?jsonlPath=${encodeURIComponent(jsonlPath)}&agent=claude`)).json();
    expect(body.inputTokens).toBe(200);
    expect(body.outputTokens).toBe(100);
    expect(body.cacheReadTokens).toBe(20);
    expect(body.cacheWrite5mTokens).toBe(40);
    expect(body.messageCount).toBe(2);
    expect(body.models["claude-opus-4-7"]).toBe(2);
    expect(body.totalTokens).toBe(360);
    // opus-4-7 = $5/$25 in, $0.5 cacheRead, $6.25 cacheWrite5m per 1M
    const expected = (200 * 5 + 100 * 25 + 20 * 0.5 + 40 * 6.25) / 1_000_000;
    expect(body.estimatedCostUSD).toBeCloseTo(expected, 10);
    expect(body.perModel["claude-opus-4-7"].input).toBe(200);
  });

  it("400s on a jsonlPath outside the session roots", async () => {
    expect((await get(`/api/claude/usage?jsonlPath=${encodeURIComponent("/etc/passwd.jsonl")}&agent=claude`)).statusCode).toBe(400);
  });
});
