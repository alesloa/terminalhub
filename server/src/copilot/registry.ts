import type { ToolDef, ToolRegistry, ToolResult, CopilotCtx } from "./types.js";

// A flat name→tool map. `collect` filters by enabled skill, `run` dispatches by name and turns an
// unknown name into a soft failure (the model sometimes hallucinates a tool — feed the miss back as
// a tool result rather than throwing the whole turn).
export function createRegistry(initial: ToolDef[] = []): ToolRegistry {
  const tools = new Map<string, ToolDef>();
  for (const t of initial) tools.set(t.name, t);

  return {
    register(tool) { tools.set(tool.name, tool); },
    collect(enabledSkillIds) {
      const enabled = new Set(enabledSkillIds);
      return [...tools.values()].filter((t) => enabled.has(t.skillId));
    },
    get(name) { return tools.get(name); },
    async run(name, args, cctx: CopilotCtx): Promise<ToolResult> {
      const def = tools.get(name);
      if (!def) return { ok: false, summary: `Unknown tool: ${name}` };
      return def.run(args, cctx);
    },
  };
}
