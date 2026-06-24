import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContext, type AppContext } from "../../context.js";
import { createMcpHub, type McpConnector } from "./client.js";
import { mcpSkill, mcpToolName } from "../skills/mcp/index.js";
import type { CopilotCtx } from "../types.js";

let app: AppContext;
beforeEach(() => { app = createContext(":memory:"); });
afterEach(() => { app.pending.stop(); });

// A fake MCP connector so tests never spawn a real process. Records close() calls.
let closed = 0;
const fakeConnect: McpConnector = async () => ({
  async listTools() { return [{ name: "web_search", description: "Search the web", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }]; },
  async callTool(name, args) { return { ok: true, text: `ran ${name}(${JSON.stringify(args)})` }; },
  async close() { closed++; },
});

describe("mcp store", () => {
  it("creates a server with an mc_ id and withholds env values (keys only)", () => {
    const s = app.store.createMcpServer({ label: "Brave", transport: "stdio", command: ["npx", "brave-mcp"], env: { BRAVE_API_KEY: "secret-123" } });
    expect(s.id).toMatch(/^mc_/);
    expect(s.command).toEqual(["npx", "brave-mcp"]);
    expect(s.envKeys).toEqual(["BRAVE_API_KEY"]);
    expect((s as any).env).toBeUndefined();          // public shape never carries values
    expect(app.store.getMcpServerConfig(s.id)!.env.BRAVE_API_KEY).toBe("secret-123"); // internal does
  });

  it("setMcpServerTools caches tools + status; update toggles enabled", () => {
    const s = app.store.createMcpServer({ label: "X", transport: "stdio", command: ["x"] });
    app.store.setMcpServerTools(s.id, [{ name: "t", description: "d", inputSchema: { type: "object" } }], "ok", null);
    const got = app.store.getMcpServer(s.id)!;
    expect(got.status).toBe("ok");
    expect(got.tools).toHaveLength(1);
    expect(app.store.updateMcpServer(s.id, { enabled: false })!.enabled).toBe(false);
  });
});

describe("mcp hub", () => {
  it("lists tools, calls a tool, and always closes the connection", async () => {
    closed = 0;
    const hub = createMcpHub({ connect: fakeConnect });
    const cfg = { id: "mc_1", label: "Brave", transport: "stdio" as const, command: ["x"], url: null, env: {}, enabled: true, tools: [], status: "unknown" as const, lastError: null, createdAt: 0, updatedAt: 0 };
    const tools = await hub.listTools(cfg);
    expect(tools[0].name).toBe("web_search");
    const r = await hub.callTool(cfg, "web_search", { q: "hi" });
    expect(r.ok).toBe(true);
    expect(r.text).toContain("ran web_search");
    expect(closed).toBe(2);                          // one per op, connect-per-call
  });
});

describe("mcp skill", () => {
  it("maps an enabled server's cached tools to Copilot tools; run() dispatches to the hub", async () => {
    app.mcp = createMcpHub({ connect: fakeConnect });
    const s = app.store.createMcpServer({ label: "Brave Search", transport: "stdio", command: ["x"] });
    app.store.setMcpServerTools(s.id, [{ name: "web_search", description: "Search", inputSchema: { type: "object" } }], "ok", null);

    const tools = mcpSkill.tools(app);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("mcp_brave_search_web_search");
    expect(tools[0].dangerous).toBe(false);

    const cctx: CopilotCtx = { app, settings: app.store.getCopilotSettings(), actor: "user" };
    const res = await tools[0].run({ q: "x" }, cctx);
    expect(res.ok).toBe(true);
    expect(res.summary).toContain("ran web_search");
  });

  it("contributes nothing for a disabled server", () => {
    const s = app.store.createMcpServer({ label: "Off", transport: "stdio", command: ["x"] });
    app.store.setMcpServerTools(s.id, [{ name: "t", description: "", inputSchema: { type: "object" } }], "ok", null);
    app.store.updateMcpServer(s.id, { enabled: false });
    expect(mcpSkill.tools(app)).toHaveLength(0);
  });

  it("mcpToolName slugifies label + tool and stays model-safe", () => {
    expect(mcpToolName("Brave Search!", "web.search")).toBe("mcp_brave_search_web_search");
    expect(mcpToolName("X", "y")).toMatch(/^[a-z0-9_]+$/);
  });
});
