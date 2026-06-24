import type { ToolDef } from "../types.js";

// Notes = the Notes panel scratchpad (ctx.store notes). "write me a note" lands here.
export const noteTools: ToolDef[] = [
  {
    name: "note_add",
    description: "Save a note to the user's Notes panel. Use for 'write me a note', 'jot this down', capturing text the user wants kept.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title (optional)" },
        content: { type: "string", description: "The note body" },
      },
      required: ["content"],
    },
    async run(args, cctx) {
      const content = typeof args?.content === "string" ? args.content : "";
      if (!content.trim()) return { ok: false, summary: "A note needs some content." };
      const title = typeof args?.title === "string" ? args.title : "";
      const note = cctx.app.store.createNote({ title, content });
      return { ok: true, summary: `Saved note${title ? `: ${title}` : ""}.`, data: { id: note.id } };
    },
  },
  {
    name: "note_list",
    description: "List the user's recent notes (titles + ids). Use to find or reference an existing note.",
    skillId: "core",
    input_schema: { type: "object", properties: {} },
    async run(_args, cctx) {
      const notes = cctx.app.store.listNotes().slice(0, 20).map((n) => ({ id: n.id, title: n.title, content: n.content }));
      return { ok: true, summary: `${notes.length} note${notes.length === 1 ? "" : "s"}.`, data: notes };
    },
  },
];
