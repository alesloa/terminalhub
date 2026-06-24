import type { ToolDef } from "../types.js";
import { notifyCategory } from "../../notify/bus.js";

const LEVELS = ["info", "success", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];
const isLevel = (l: unknown): l is Level => (LEVELS as readonly string[]).includes(l as string);

// Fire an immediate notification/toast (the same pipeline /api/notify uses). For a *future* nudge use
// reminder_set instead — this one shows right now.
export const alertTools: ToolDef[] = [
  {
    name: "send_alert",
    description: "Show the user a notification/toast right now (notification center + optional voice). Use to flag something immediately. For a scheduled nudge use reminder_set instead.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The alert message" },
        title: { type: "string", description: "Optional title" },
        level: { type: "string", enum: ["info", "success", "warn", "error"], description: "Severity (default info)" },
        speak: { type: "boolean", description: "Read it aloud (default false)" },
      },
      required: ["text"],
    },
    async run(args, cctx) {
      const text = typeof args?.text === "string" ? args.text.trim() : "";
      if (!text) return { ok: false, summary: "An alert needs text." };
      const level: Level = isLevel(args?.level) ? args.level : "info";
      cctx.app.pending.fire({
        text,
        title: typeof args?.title === "string" ? args.title : undefined,
        level,
        category: notifyCategory(level, "notify"),
        source: "notify",
        speak: args?.speak === true,
      });
      return { ok: true, summary: `Alerted: ${text}` };
    },
  },
];
