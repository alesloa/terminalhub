import type { ToolDef } from "../types.js";

// Terminal awareness + control. terminal_list is read-only; terminal_send types into a live tmux
// session and is DANGEROUS (confirm-gated, never auto-run by the scheduler) — it can run commands.
export const terminalTools: ToolDef[] = [
  {
    name: "terminal_list",
    description: "List terminals (id, title, workspace). Pass workspaceId to scope to one workspace, omit for all.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: { workspaceId: { type: "string", description: "Scope to one workspace (optional)" } },
    },
    async run(args, cctx) {
      const wid = typeof args?.workspaceId === "string" ? args.workspaceId : null;
      const terms = (wid ? cctx.app.store.listTerminals(wid) : cctx.app.store.listAllTerminals())
        .map((t) => ({ id: t.id, title: t.title, workspaceId: t.workspaceId }));
      return { ok: true, summary: `${terms.length} terminal${terms.length === 1 ? "" : "s"}.`, data: terms };
    },
  },
  {
    name: "terminal_send",
    description: "Type text into a terminal's live session, optionally pressing Enter to run it. DANGEROUS — can execute commands. Always confirm intent first.",
    dangerous: true,
    skillId: "core",
    input_schema: {
      type: "object",
      properties: {
        terminalId: { type: "string", description: "Target terminal id" },
        text: { type: "string", description: "Text to type" },
        enter: { type: "boolean", description: "Press Enter after typing to submit (default false)" },
      },
      required: ["terminalId", "text"],
    },
    async run(args, cctx) {
      const id = typeof args?.terminalId === "string" ? args.terminalId : "";
      const text = typeof args?.text === "string" ? args.text : "";
      const term = cctx.app.store.getTerminal(id);
      if (!term) return { ok: false, summary: `No terminal with id ${id}.` };
      await cctx.app.tmux.typeText(term.tmuxSession, text);
      if (args?.enter === true) await cctx.app.tmux.sendEnter(term.tmuxSession);
      return { ok: true, summary: `Sent to "${term.title}"${args?.enter === true ? " (submitted)" : ""}.` };
    },
  },
];
