import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import type { ReminderStatus } from "../types.js";

// Calendar reminders / scheduled notifications REST. One row powers both the calendar (a view over
// these) and the one-off "ping me" form. Server-backed so a loopback agent can create reminders the
// same way it posts to /api/notify:
//   curl -s -X POST localhost:8189/api/reminders -H 'content-type: application/json' \
//     -d '{"title":"check deploy","fireAt":1781000000000}'
// All instants are epoch-ms UTC; the browser converts to/from the viewer's local zone.

const STATUSES: ReminderStatus[] = ["pending", "snoozed", "fired", "cancelled", "missed"];
const channels = z.object({ inApp: z.boolean(), pushover: z.boolean(), speak: z.boolean() });
const recurrence = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365),
  until: z.number().int().nullable(),
  count: z.number().int().min(1).nullable(),
}).nullable();
const level = z.enum(["info", "success", "warn", "error"]);
// Image is a base64 data URL. Cap the string near Pushover's 5 MB attachment limit (base64 ≈ 4/3 of
// the bytes, so ~7 MB of base64 text).
const imageDataUrl = z.string().max(7_500_000).regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "image must be a base64 image data URL");

const baseFields = {
  body: z.string().max(5000).optional(),
  allDay: z.boolean().optional(),
  endAt: z.number().int().nullable().optional(),
  leadMinutes: z.number().int().min(0).max(40320).optional(), // up to 4 weeks of lead
  color: z.string().max(32).nullable().optional(),
  channels: channels.optional(),
  level: level.optional(),
  priority: z.number().int().min(-2).max(2).optional(),
  recurrence: recurrence.optional(),
};

export async function reminderRoutes(app: FastifyInstance, ctx: AppContext) {
  // Apply/clear a reminder's image, then sync the imagePath marker. Returns the (possibly updated)
  // reminder. `image === undefined` leaves it untouched; a data URL sets it; null clears it.
  const applyImage = (id: string, image: string | null | undefined) => {
    if (image === undefined) return;
    if (image === null) {
      ctx.store.deleteReminderImage(id);
      ctx.store.updateReminder(id, { imagePath: null });
    } else {
      ctx.store.setReminderImage(id, image);
      ctx.store.updateReminder(id, { imagePath: `/api/reminders/${id}/image` });
    }
  };

  app.get("/api/reminders", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const from = q.from != null ? Number(q.from) : undefined;
    const to = q.to != null ? Number(q.to) : undefined;
    const status = q.status
      ? (q.status.split(",").filter((s) => (STATUSES as string[]).includes(s)) as ReminderStatus[])
      : undefined;
    return { reminders: ctx.store.listReminders({ from, to, status: status?.length ? status : undefined }) };
  });

  app.post("/api/reminders", async (req, reply) => {
    const b = z.object({
      title: z.string().min(1).max(200),
      // Three ways to set the fire instant — pick whichever is convenient. A loopback agent can skip
      // epoch-ms math and just say `fireInMinutes` ("ping me in 2h") or `fireAtISO` (an absolute ISO).
      fireAt: z.number().int().optional(),       // epoch ms (the canonical form the browser sends)
      fireAtISO: z.string().optional(),          // absolute ISO-8601; parsed to epoch ms
      fireInMinutes: z.number().min(0).max(525_600).optional(), // relative to now (up to one year out)
      image: imageDataUrl.optional(),
      ...baseFields,
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { image, fireAt, fireAtISO, fireInMinutes, ...fields } = b.data;
    // Resolve a single epoch-ms instant. Precedence: explicit ms → ISO → relative minutes.
    let resolved: number | undefined = fireAt;
    if (resolved == null && fireAtISO != null) {
      const ms = Date.parse(fireAtISO);
      if (Number.isNaN(ms)) return reply.code(400).send({ error: "fireAtISO is not a valid date" });
      resolved = ms;
    }
    if (resolved == null && fireInMinutes != null) resolved = Date.now() + fireInMinutes * 60_000;
    if (resolved == null) return reply.code(400).send({ error: "provide fireAt, fireAtISO, or fireInMinutes" });
    const rem = ctx.store.createReminder({ ...fields, fireAt: resolved });
    applyImage(rem.id, image);
    return { reminder: ctx.store.getReminder(rem.id)! };
  });

  app.patch("/api/reminders/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getReminder(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      title: z.string().min(1).max(200).optional(),
      fireAt: z.number().int().optional(),
      status: z.enum(STATUSES as unknown as [string, ...string[]]).optional(),
      image: imageDataUrl.nullable().optional(),
      ...baseFields,
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const { image, ...patch } = b.data;
    ctx.store.updateReminder(id, patch as any);
    applyImage(id, image);
    return { reminder: ctx.store.getReminder(id)! };
  });

  app.delete("/api/reminders/:id", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getReminder(id)) return reply.code(404).send({ error: "not found" });
    ctx.store.deleteReminder(id);
    return { ok: true };
  });

  app.post("/api/reminders/:id/snooze", async (req, reply) => {
    const id = (req.params as any).id as string;
    if (!ctx.store.getReminder(id)) return reply.code(404).send({ error: "not found" });
    const b = z.object({
      minutes: z.number().int().min(1).max(525600).optional(),
      until: z.number().int().optional(),
    }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "invalid body" });
    const until = b.data.until ?? (b.data.minutes != null ? Date.now() + b.data.minutes * 60_000 : undefined);
    if (until == null) return reply.code(400).send({ error: "provide minutes or until" });
    return { reminder: ctx.store.snoozeReminder(id, until)! };
  });

  // Serve a reminder's attached image bytes (decoded from the stored data URL) so an <img> can show
  // it. Under /api so it's auth-gated like everything else.
  app.get("/api/reminders/:id/image", async (req, reply) => {
    const id = (req.params as any).id as string;
    const dataUrl = ctx.store.getReminderImage(id);
    const m = dataUrl ? /^data:([^;]+);base64,(.*)$/s.exec(dataUrl) : null;
    if (!m) return reply.code(404).send({ error: "not found" });
    return reply.header("Cache-Control", "no-store").type(m[1]).send(Buffer.from(m[2], "base64"));
  });
}
