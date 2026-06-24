import type { ToolDef } from "../types.js";

// Read-only views of the canvas: the workspace cards and the virtual spaces. Lets the copilot answer
// "what workspaces do I have?" and reference them by id for other actions.
export const canvasTools: ToolDef[] = [
  {
    name: "workspace_list",
    description: "List the user's workspace cards (id, name, host folder). Use to see or reference workspaces.",
    skillId: "core",
    input_schema: { type: "object", properties: {} },
    async run(_args, cctx) {
      const ws = cctx.app.store.listWorkspaces().map((w) => ({ id: w.id, name: w.name, folder: w.folder, spaceId: w.spaceId }));
      return { ok: true, summary: `${ws.length} workspace${ws.length === 1 ? "" : "s"}.`, data: ws };
    },
  },
  {
    name: "space_list",
    description: "List the virtual spaces (desktops) on the canvas.",
    skillId: "core",
    input_schema: { type: "object", properties: {} },
    async run(_args, cctx) {
      const spaces = cctx.app.store.listSpaces().map((s) => ({ id: s.id, name: s.name }));
      return { ok: true, summary: `${spaces.length} space${spaces.length === 1 ? "" : "s"}.`, data: spaces };
    },
  },
];
