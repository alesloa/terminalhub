import type { AppContext } from "../../../context.js";
import type { ToolDef, JsonSchema } from "../../types.js";
import type { CopilotMcpToolInfo } from "../../../types.js";
import type { Skill } from "../types.js";

// The MCP skill turns every ENABLED tool server's cached tools into Copilot tools. It's always-on (the
// per-server `enabled` flag is the real gate); when no servers are connected it contributes nothing.
// Tools run by connecting to the server live (app.mcp.callTool). The user opted these in, so they run
// without confirmation (dangerous:false) — which also lets them be used in scheduled loops.
export const mcpSkill: Skill = {
  id: "mcp",
  name: "Tool servers (MCP)",
  description: "Connect MCP servers to give the Copilot extra tools (search, browsers, APIs, your own servers).",
  icon: "🔌",
  builtin: true,
  accountsProvider: false,
  examples: [],
  tools(app: AppContext): ToolDef[] {
    const out: ToolDef[] = [];
    const used = new Set<string>();
    for (const s of app.store.listMcpServers()) {
      if (!s.enabled) continue;
      for (const t of s.tools) {
        let name = mcpToolName(s.label, t.name);
        while (used.has(name)) name = `${name}_`.slice(0, 64); // de-dupe within a turn
        used.add(name);
        out.push(makeMcpTool(s.id, s.label, name, t));
      }
    }
    return out;
  },
};

function makeMcpTool(serverId: string, serverLabel: string, name: string, t: CopilotMcpToolInfo): ToolDef {
  return {
    name,
    description: `[${serverLabel}] ${t.description || t.name}`.slice(0, 1000),
    input_schema: asObjectSchema(t.inputSchema),
    dangerous: false,
    skillId: "mcp",
    async run(args, cctx) {
      const cfg = cctx.app.store.getMcpServerConfig(serverId);
      if (!cfg) return { ok: false, summary: `MCP server "${serverLabel}" is no longer connected.` };
      try {
        const r = await cctx.app.mcp.callTool(cfg, t.name, args);
        return r.ok
          ? { ok: true, summary: oneLine(r.text) || `${t.name} ran.`, data: r.text }
          : { ok: false, summary: `MCP error from ${t.name}: ${oneLine(r.text)}`, data: r.text };
      } catch (e) {
        return { ok: false, summary: `MCP "${serverLabel}" failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

// "Brave Search" + "brave_web_search" → "mcp_brave_search_brave_web_search" (clamped, model-safe).
export function mcpToolName(serverLabel: string, toolName: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `mcp_${slug(serverLabel)}_${slug(toolName)}`.slice(0, 64).replace(/_+$/g, "") || "mcp_tool";
}

function asObjectSchema(s: Record<string, unknown>): JsonSchema {
  if (s && s.type === "object") return s as unknown as JsonSchema;
  const base: JsonSchema = { type: "object", properties: (s?.properties as Record<string, unknown>) ?? {} };
  if (Array.isArray(s?.required)) base.required = s.required as string[];
  return base;
}
function oneLine(s: string): string {
  const flat = (s ?? "").replace(/\s+/g, " ").trim();
  return flat.length > 240 ? `${flat.slice(0, 237)}…` : flat;
}
