import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { createContext, type AppContext } from "../context.js";
import { copilotRoutes } from "./copilot.js";

let app: ReturnType<typeof Fastify>;
let ctx: AppContext;

beforeEach(async () => {
  ctx = createContext(":memory:");
  app = Fastify();
  await app.register(async (a) => copilotRoutes(a, ctx));
  await app.ready();
});
afterEach(async () => { await app.close(); });

const get = (url: string) => app.inject({ method: "GET", url });
const post = (url: string, payload?: unknown) => app.inject({ method: "POST", url, payload });
const patch = (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, payload });
const del = (url: string) => app.inject({ method: "DELETE", url });

describe("copilot settings", () => {
  it("GET returns the defaults before anything is set", async () => {
    const r = await get("/api/copilot/settings");
    expect(r.statusCode).toBe(200);
    expect(r.json().settings).toEqual({
      enabled: true,
      defaultEngine: null,
      reportChannels: ["toast"],
      confirmDangerous: true,
      orbEnabled: true,
      orbPosition: "bottom-right",
    });
  });

  it("PATCH disables the copilot and persists (the enable toggle)", async () => {
    const r = await patch("/api/copilot/settings", { enabled: false });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings.enabled).toBe(false);
    // survives a fresh read
    expect((await get("/api/copilot/settings")).json().settings.enabled).toBe(false);
  });

  it("PATCH merges field-by-field, leaving untouched fields intact", async () => {
    await patch("/api/copilot/settings", { confirmDangerous: false });
    const s = (await patch("/api/copilot/settings", { orbEnabled: false })).json().settings;
    expect(s.confirmDangerous).toBe(false); // from the earlier patch
    expect(s.orbEnabled).toBe(false);
    expect(s.enabled).toBe(true);           // never touched → still default
  });

  it("PATCH stores the report-channel list and the default engine id", async () => {
    const s = (await patch("/api/copilot/settings", {
      reportChannels: ["toast", "voice", "pushover"],
      defaultEngine: "ai_openai",
    })).json().settings;
    expect(s.reportChannels).toEqual(["toast", "voice", "pushover"]);
    expect(s.defaultEngine).toBe("ai_openai");
  });

  it("PATCH rejects an unknown orb position", async () => {
    expect((await patch("/api/copilot/settings", { orbPosition: "middle" })).statusCode).toBe(400);
  });

  it("PATCH rejects an unknown report channel", async () => {
    expect((await patch("/api/copilot/settings", { reportChannels: ["email"] })).statusCode).toBe(400);
  });

  it("PATCH clears the default engine back to null", async () => {
    await patch("/api/copilot/settings", { defaultEngine: "ai_openai" });
    const s = (await patch("/api/copilot/settings", { defaultEngine: null })).json().settings;
    expect(s.defaultEngine).toBe(null);
  });
});

describe("copilot conversations", () => {
  it("create, list, get-with-messages, delete", async () => {
    expect((await get("/api/copilot/conversations")).json().conversations).toEqual([]);

    const created = (await post("/api/copilot/conversations", { title: "Morning" })).json().conversation;
    expect(created.id).toMatch(/^co_/);
    expect(created.title).toBe("Morning");

    expect((await get("/api/copilot/conversations")).json().conversations).toHaveLength(1);

    const one = (await get(`/api/copilot/conversations/${created.id}`)).json();
    expect(one.conversation.id).toBe(created.id);
    expect(one.messages).toEqual([]);

    expect((await del(`/api/copilot/conversations/${created.id}`)).statusCode).toBe(200);
    expect((await get("/api/copilot/conversations")).json().conversations).toHaveLength(0);
  });

  it("GET a missing conversation 404s", async () => {
    expect((await get("/api/copilot/conversations/co_nope")).statusCode).toBe(404);
  });

  it("returns stored messages with parsed content blocks", async () => {
    const id = (await post("/api/copilot/conversations", {})).json().conversation.id;
    ctx.store.addCopilotMessage({ conversationId: id, role: "user", content: '[{"type":"text","text":"hi"}]' });
    const msgs = (await get(`/api/copilot/conversations/${id}`)).json().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("copilot message turn (non-streaming)", () => {
  it("fails clearly when no AI engine is configured", async () => {
    const id = (await post("/api/copilot/conversations", {})).json().conversation.id;
    const r = await post(`/api/copilot/conversations/${id}/messages`, { text: "hi" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.toLowerCase()).toContain("engine");
  });

  it("rejects an empty message", async () => {
    const id = (await post("/api/copilot/conversations", {})).json().conversation.id;
    expect((await post(`/api/copilot/conversations/${id}/messages`, { text: "" })).statusCode).toBe(400);
  });

  it("404s a message to a missing conversation", async () => {
    expect((await post("/api/copilot/conversations/co_ghost/messages", { text: "hi" })).statusCode).toBe(404);
  });
});

describe("copilot skills", () => {
  it("lists skills including the always-on core skill", async () => {
    const r = await get("/api/copilot/skills");
    expect(r.statusCode).toBe(200);
    const core = r.json().skills.find((s: any) => s.id === "core");
    expect(core.builtin).toBe(true);
    expect(core.enabled).toBe(true);
    expect(core.examples.length).toBeGreaterThan(0);
  });

  it("refuses to disable the built-in core skill", async () => {
    const r = await patch("/api/copilot/skills/core", { enabled: false });
    expect(r.statusCode).toBe(200);
    expect(r.json().skill.enabled).toBe(true); // still on
  });

  it("404s an unknown skill", async () => {
    expect((await patch("/api/copilot/skills/ghost", { enabled: true })).statusCode).toBe(404);
  });
});

describe("copilot email accounts", () => {
  it("creates an account and NEVER returns the secret", async () => {
    const r = await post("/api/copilot/skills/email/accounts", { label: "Personal", provider: "gmail", config: { user: "me@gmail.com" }, secret: "app-password" });
    expect(r.statusCode).toBe(200);
    const acc = r.json().account;
    expect(acc.id).toMatch(/^ca_/);
    expect(acc.hasSecret).toBe(true);
    expect(acc.secret).toBeUndefined();
    expect(JSON.stringify(r.json())).not.toContain("app-password");
  });

  it("lists accounts without secrets", async () => {
    await post("/api/copilot/skills/email/accounts", { label: "A", provider: "gmail", config: {}, secret: "s" });
    const list = (await get("/api/copilot/skills/email/accounts")).json().accounts;
    expect(list).toHaveLength(1);
    expect(list[0].secret).toBeUndefined();
    expect(list[0].hasSecret).toBe(true);
  });

  it("updates and deletes an account", async () => {
    const id = (await post("/api/copilot/skills/email/accounts", { label: "Old", provider: "imap", config: { host: "a" }, secret: "x" })).json().account.id;
    const upd = (await patch(`/api/copilot/skills/email/accounts/${id}`, { label: "New" })).json().account;
    expect(upd.label).toBe("New");
    expect((await del(`/api/copilot/skills/email/accounts/${id}`)).statusCode).toBe(200);
    expect((await get("/api/copilot/skills/email/accounts")).json().accounts).toHaveLength(0);
  });

  it("404s accounts on a skill that doesn't manage them (core)", async () => {
    expect((await get("/api/copilot/skills/core/accounts")).statusCode).toBe(404);
  });

  it("rejects an unknown provider", async () => {
    expect((await post("/api/copilot/skills/email/accounts", { label: "x", provider: "aol", secret: "s" })).statusCode).toBe(400);
  });
});

describe("copilot jobs (scheduled loops)", () => {
  it("POST creates a loop, GET lists it", async () => {
    const r = await post("/api/copilot/jobs", { title: "Inbox", tool: "board_list", intervalSec: 1800, reportMode: "on-find" });
    expect(r.statusCode).toBe(200);
    const job = r.json().job;
    expect(job.id).toMatch(/^cj_/);
    expect(job.tool).toBe("board_list");
    expect(job.reportMode).toBe("on-find");
    const list = (await get("/api/copilot/jobs")).json().jobs;
    expect(list).toHaveLength(1);
  });

  it("POST rejects an unknown tool", async () => {
    expect((await post("/api/copilot/jobs", { tool: "nope", intervalSec: 600 })).statusCode).toBe(400);
  });

  it("POST refuses a dangerous tool", async () => {
    expect((await post("/api/copilot/jobs", { tool: "terminal_send", intervalSec: 600 })).statusCode).toBe(400);
  });

  it("POST rejects an interval under a minute", async () => {
    expect((await post("/api/copilot/jobs", { tool: "board_list", intervalSec: 30 })).statusCode).toBe(400);
  });

  it("PATCH toggles enabled and DELETE removes the loop", async () => {
    const id = (await post("/api/copilot/jobs", { tool: "board_list", intervalSec: 600 })).json().job.id;
    expect((await patch(`/api/copilot/jobs/${id}`, { enabled: false })).json().job.enabled).toBe(false);
    expect((await del(`/api/copilot/jobs/${id}`)).statusCode).toBe(200);
    expect((await get("/api/copilot/jobs")).json().jobs).toHaveLength(0);
  });

  it("PATCH and DELETE 404 on a missing loop", async () => {
    expect((await patch("/api/copilot/jobs/cj_ghost", { enabled: false })).statusCode).toBe(404);
    expect((await del("/api/copilot/jobs/cj_ghost")).statusCode).toBe(404);
  });
});

describe("copilot schedulable tools", () => {
  it("GET /tools lists non-dangerous tools and excludes terminal_send", async () => {
    const tools = (await get("/api/copilot/tools")).json().tools as { name: string }[];
    const names = tools.map((t) => t.name);
    expect(names).toContain("board_list");
    expect(names).not.toContain("terminal_send");
  });
});

describe("copilot MCP servers", () => {
  // Inject a fake hub so routes never spawn a real MCP process.
  const fakeHub = {
    listTools: async () => [{ name: "web_search", description: "Search", inputSchema: { type: "object" } }],
    callTool: async () => ({ ok: true, text: "ok" }),
  };
  beforeEach(() => { (ctx as any).mcp = fakeHub; });

  it("POST creates a server, discovers its tools, and never returns env values", async () => {
    const r = await post("/api/copilot/mcp", { label: "Brave", transport: "stdio", command: ["npx", "brave"], env: { BRAVE_API_KEY: "secret" } });
    expect(r.statusCode).toBe(200);
    const s = r.json().server;
    expect(s.id).toMatch(/^mc_/);
    expect(s.status).toBe("ok");
    expect(s.tools).toHaveLength(1);
    expect(s.envKeys).toEqual(["BRAVE_API_KEY"]);
    expect(JSON.stringify(s)).not.toContain("secret");
    expect((await get("/api/copilot/mcp")).json().servers).toHaveLength(1);
  });

  it("POST rejects stdio without a command and http without a url", async () => {
    expect((await post("/api/copilot/mcp", { label: "x", transport: "stdio", command: [] })).statusCode).toBe(400);
    expect((await post("/api/copilot/mcp", { label: "x", transport: "http" })).statusCode).toBe(400);
  });

  it("PATCH toggles enabled, refresh re-discovers, DELETE removes", async () => {
    const id = (await post("/api/copilot/mcp", { label: "X", transport: "stdio", command: ["x"] })).json().server.id;
    expect((await patch(`/api/copilot/mcp/${id}`, { enabled: false })).json().server.enabled).toBe(false);
    expect((await post(`/api/copilot/mcp/${id}/refresh`)).json().server.status).toBe("ok");
    expect((await del(`/api/copilot/mcp/${id}`)).statusCode).toBe(200);
    expect((await get("/api/copilot/mcp")).json().servers).toHaveLength(0);
  });

  it("GET /importable returns an array of global servers (shape only)", async () => {
    const r = await get("/api/copilot/mcp/importable");
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(r.json().servers)).toBe(true);
  });
});
