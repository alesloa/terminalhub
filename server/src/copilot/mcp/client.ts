import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CopilotMcpServerConfig, CopilotMcpToolInfo } from "../../types.js";

// A thin client over the official MCP SDK. The Copilot connects to a configured server, lists its
// tools (cached into the DB at connect time), and calls one when the agent picks it. Connect-per-call
// keeps lifecycle dead simple (no stale clients / leaked stdio processes) at the cost of a reconnect
// per op — fine for chat-frequency use; a connection cache is a later optimization. The connector is
// injectable so tests don't spawn real processes.

export interface McpCallResult { ok: boolean; text: string; }
export interface McpConn {
  listTools(): Promise<CopilotMcpToolInfo[]>;
  callTool(name: string, args: unknown): Promise<McpCallResult>;
  close(): Promise<void>;
}
export type McpConnector = (cfg: CopilotMcpServerConfig) => Promise<McpConn>;

export interface McpHub {
  listTools(cfg: CopilotMcpServerConfig): Promise<CopilotMcpToolInfo[]>;
  callTool(cfg: CopilotMcpServerConfig, name: string, args: unknown): Promise<McpCallResult>;
}

const OP_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function createMcpHub(opts: { connect?: McpConnector } = {}): McpHub {
  const connect = opts.connect ?? defaultConnect;
  async function withConn<T>(cfg: CopilotMcpServerConfig, fn: (c: McpConn) => Promise<T>): Promise<T> {
    const conn = await withTimeout(connect(cfg), OP_TIMEOUT_MS, `MCP "${cfg.label}" connect`);
    try { return await withTimeout(fn(conn), OP_TIMEOUT_MS, `MCP "${cfg.label}" call`); }
    finally { await conn.close().catch(() => { /* best-effort */ }); }
  }
  return {
    listTools: (cfg) => withConn(cfg, (c) => c.listTools()),
    callTool: (cfg, name, args) => withConn(cfg, (c) => c.callTool(name, args)),
  };
}

// Default connector — real SDK transports. stdio spawns `command` on the host with the inherited env
// plus the server's own env; http connects to the streamable endpoint.
const defaultConnect: McpConnector = async (cfg) => {
  const client = new Client({ name: "terminalhub-copilot", version: "1.0.0" });
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  if (cfg.transport === "stdio") {
    const [command, ...args] = cfg.command;
    if (!command) throw new Error("An stdio MCP server needs a command.");
    transport = new StdioClientTransport({ command, args, env: { ...envStrings(), ...cfg.env } });
  } else {
    if (!cfg.url) throw new Error("An http MCP server needs a url.");
    transport = new StreamableHTTPClientTransport(new URL(cfg.url));
  }
  await client.connect(transport);
  return {
    async listTools() {
      const r = await client.listTools();
      return (r.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? "", inputSchema: normSchema(t.inputSchema) }));
    },
    async callTool(name, args) {
      const r = await client.callTool({ name, arguments: (args && typeof args === "object" ? (args as Record<string, unknown>) : {}) });
      const content = Array.isArray(r.content) ? r.content : [];
      const text = content.map((c: any) => (c?.type === "text" ? String(c.text) : `[${c?.type ?? "content"}]`)).join("\n");
      return { ok: !r.isError, text };
    },
    async close() { await client.close(); },
  };
};

function envStrings(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
}
function normSchema(s: unknown): Record<string, unknown> {
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : { type: "object", properties: {} };
}
