import type { ToolDef } from "../types.js";

// Calendar reminders (ctx.store reminders + the reminder scheduler fires them). "remind me in 30
// minutes", "set a reminder for 3pm". A time is required — `inMinutes` (relative) or `atISO` (absolute).
export const reminderTools: ToolDef[] = [
  {
    name: "reminder_set",
    description: "Schedule a reminder that fires at a future time (toast + optional voice/Pushover). Provide inMinutes (relative) OR atISO (absolute ISO-8601). Use for 'remind me…'.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What to remind about" },
        inMinutes: { type: "number", description: "Fire this many minutes from now" },
        atISO: { type: "string", description: "Absolute time, ISO-8601 (e.g. 2026-06-21T15:00:00)" },
        body: { type: "string", description: "Optional extra detail" },
      },
      required: ["title"],
    },
    async run(args, cctx) {
      const title = typeof args?.title === "string" ? args.title.trim() : "";
      if (!title) return { ok: false, summary: "A reminder needs a title." };
      let fireAt: number | null = null;
      if (typeof args?.inMinutes === "number" && Number.isFinite(args.inMinutes)) fireAt = Date.now() + args.inMinutes * 60_000;
      else if (typeof args?.atISO === "string") { const t = Date.parse(args.atISO); if (Number.isFinite(t)) fireAt = t; }
      if (fireAt === null) return { ok: false, summary: "Give a time: inMinutes (relative) or atISO (absolute)." };
      const r = cctx.app.store.createReminder({ title, body: typeof args?.body === "string" ? args.body : "", fireAt });
      return { ok: true, summary: `Reminder set: "${title}" for ${new Date(fireAt).toLocaleString()}.`, data: { id: r.id, fireAt } };
    },
  },
  {
    name: "reminder_list",
    description: "List upcoming reminders (pending or snoozed) in the next `withinHours` (default 168 = one week).",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: { withinHours: { type: "number", description: "Look-ahead window in hours (default 168)" } },
    },
    async run(args, cctx) {
      const now = Date.now();
      const hours = typeof args?.withinHours === "number" && args.withinHours > 0 ? args.withinHours : 168;
      const list = cctx.app.store
        .listReminders({ from: now, to: now + hours * 3_600_000, status: ["pending", "snoozed"] })
        .map((r) => ({ id: r.id, title: r.title, fireAt: r.fireAt, when: new Date(r.fireAt).toLocaleString() }));
      return { ok: true, summary: `${list.length} upcoming reminder${list.length === 1 ? "" : "s"}.`, data: list };
    },
  },
];
