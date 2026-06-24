import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { BOARD_COLUMNS } from "../types.js";

// Task board (kanban). A single global board of cards split across three columns (todo/doing/done).
// Cards are server-backed so terminal agents can read and move them on loopback, e.g.:
//   curl -s localhost:8189/api/board
//   curl -s -X POST localhost:8189/api/board/cards -H 'content-type: application/json' -d '{"title":"ship"}'
//   curl -s -X PATCH localhost:8189/api/board/cards/<id> -H 'content-type: application/json' -d '{"column":"done"}'
// PATCH is the one mutation verb for content (title/body/color) AND placement (column/position) so a
// caller can do everything through a single endpoint. `position` is the index among the column's
// other cards (0 = top); omit it to append.
export async function boardRoutes(app: FastifyInstance, ctx: AppContext) {
  const column = z.enum(BOARD_COLUMNS as unknown as [string, ...string[]]);

  app.get("/api/board", async () => ({ cards: ctx.store.listBoardCards() }));

  app.post("/api/board/cards", async (req, reply) => {
    const b = z.object({
      column: column.default("todo"),
      title: z.string().default(""),
      body: z.string().default(""),
      color: z.string().nullable().default(null),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const card = ctx.store.createBoardCard(b.data as any);
    return { card };
  });

  app.patch("/api/board/cards/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    const cur = ctx.store.getBoardCard(id);
    if (!cur) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      title: z.string().optional(),
      body: z.string().optional(),
      color: z.string().nullable().optional(),
      column: column.optional(),
      position: z.number().int().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });

    const patch: Record<string, unknown> = {};
    if (b.data.title !== undefined) patch.title = b.data.title;
    if (b.data.body !== undefined) patch.body = b.data.body;
    if (b.data.color !== undefined) patch.color = b.data.color; // null clears the accent
    if (Object.keys(patch).length) ctx.store.updateBoardCard(id, patch as any);

    if (b.data.column !== undefined || b.data.position !== undefined) {
      const col = (b.data.column ?? cur.column) as typeof cur.column;
      // Append to the end when crossing columns without an explicit index; otherwise hold/adjust.
      const pos = b.data.position ?? (col !== cur.column ? Number.MAX_SAFE_INTEGER : cur.position);
      ctx.store.moveBoardCard(id, col, pos);
    }
    return { card: ctx.store.getBoardCard(id)! };
  });

  app.delete("/api/board/cards/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getBoardCard(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteBoardCard(id);
    return { ok: true };
  });
}
