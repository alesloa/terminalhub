import type { ToolDef } from "../types.js";
import type { BoardColumn } from "../../types.js";

const COLUMNS: BoardColumn[] = ["todo", "doing", "done"];
const isColumn = (c: unknown): c is BoardColumn => COLUMNS.includes(c as BoardColumn);

// The floating kanban to-do board (ctx.store board cards). "add to my to-do list", "move X to done".
export const boardTools: ToolDef[] = [
  {
    name: "board_list",
    description: "List the task board's cards grouped by column (todo / doing / done). Use to read the user's to-do list.",
    skillId: "core",
    input_schema: { type: "object", properties: {} },
    async run(_args, cctx) {
      const cards = cctx.app.store.listBoardCards().map((c) => ({ id: c.id, title: c.title, column: c.column }));
      return { ok: true, summary: `${cards.length} card${cards.length === 1 ? "" : "s"} on the board.`, data: cards };
    },
  },
  {
    name: "board_add_card",
    description: "Add a card to the task board / to-do list. Default column is 'todo'.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Card title" },
        body: { type: "string", description: "Optional details" },
        column: { type: "string", enum: ["todo", "doing", "done"], description: "Column (default todo)" },
      },
      required: ["title"],
    },
    async run(args, cctx) {
      const title = typeof args?.title === "string" ? args.title.trim() : "";
      if (!title) return { ok: false, summary: "A card needs a title." };
      const column = args?.column ?? "todo";
      if (!isColumn(column)) return { ok: false, summary: `Unknown column '${column}'. Use todo, doing or done.` };
      const card = cctx.app.store.createBoardCard({ column, title, body: typeof args?.body === "string" ? args.body : "", color: null });
      return { ok: true, summary: `Added "${title}" to ${column}.`, data: { id: card.id } };
    },
  },
  {
    name: "board_move_card",
    description: "Move a board card to a different column (e.g. mark it done).",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card id" },
        column: { type: "string", enum: ["todo", "doing", "done"] },
        position: { type: "number", description: "Position within the column (default top)" },
      },
      required: ["id", "column"],
    },
    async run(args, cctx) {
      const id = typeof args?.id === "string" ? args.id : "";
      if (!cctx.app.store.getBoardCard(id)) return { ok: false, summary: `No card with id ${id}.` };
      if (!isColumn(args?.column)) return { ok: false, summary: `Unknown column '${args?.column}'.` };
      cctx.app.store.moveBoardCard(id, args.column, typeof args?.position === "number" ? args.position : 0);
      return { ok: true, summary: `Moved card to ${args.column}.` };
    },
  },
];
