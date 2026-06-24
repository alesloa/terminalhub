import type { ToolDef } from "../types.js";
import type { CopilotReportMode } from "../../types.js";

const MODES: CopilotReportMode[] = ["always", "on-change", "on-find"];

// Let the copilot put a tool on a repeating background loop ("check my email every 30 min and tell
// me when something new lands"). A job runs one tool unattended via the scheduler, so dangerous tools
// (those that type into terminals / launch agents) are refused here AND at run time. Validation reuses
// the live registry via dynamic import to avoid a static cycle (tools → registry → skills → tools).
export const scheduleTools: ToolDef[] = [
  {
    name: "schedule_create",
    description:
      "Put a tool on a repeating background loop that runs unattended and reports back (e.g. run email_check every 30 minutes). Dangerous tools that type into terminals can't be scheduled. Use this for 'every…', 'keep checking…', 'on a loop', 'in the background'.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short label for the loop, e.g. 'Inbox check'" },
        tool: { type: "string", description: "Name of the tool to run each cycle, e.g. email_check, board_list" },
        args: { type: "object", description: "Arguments passed to that tool every run" },
        everyMinutes: { type: "number", description: "Run interval in minutes (minimum 1)" },
        reportMode: {
          type: "string",
          enum: ["always", "on-change", "on-find"],
          description: "always = report every run; on-change = only when the result differs from last time; on-find = only when it found items. Default on-change.",
        },
      },
      required: ["tool", "everyMinutes"],
    },
    async run(args, cctx) {
      const tool = typeof args?.tool === "string" ? args.tool.trim() : "";
      if (!tool) return { ok: false, summary: "A loop needs a tool to run." };
      const everyMinutes = typeof args?.everyMinutes === "number" && Number.isFinite(args.everyMinutes) ? args.everyMinutes : 0;
      if (everyMinutes < 1) return { ok: false, summary: "Set everyMinutes to at least 1." };

      const { createRegistry } = await import("../registry.js");
      const { collectTools } = await import("../skills/registry.js");
      const def = createRegistry(collectTools(cctx.app)).get(tool);
      if (!def) return { ok: false, summary: `No tool named "${tool}" — can't schedule it.` };
      if (def.dangerous) return { ok: false, summary: `"${tool}" is dangerous and can't be auto-run on a loop.` };

      const reportMode: CopilotReportMode = MODES.includes(args?.reportMode as CopilotReportMode) ? (args.reportMode as CopilotReportMode) : "on-change";
      const jobArgs = args?.args && typeof args.args === "object" ? (args.args as Record<string, unknown>) : {};
      const job = cctx.app.store.createCopilotJob({
        title: typeof args?.title === "string" ? args.title : "",
        tool,
        args: jobArgs,
        intervalSec: Math.round(everyMinutes * 60),
        reportMode,
      });
      return {
        ok: true,
        summary: `Scheduled "${job.title || tool}" every ${everyMinutes} min (${reportMode}). First run ${new Date(job.nextRun).toLocaleString()}.`,
        data: { id: job.id },
      };
    },
  },
  {
    name: "schedule_list",
    description: "List the active background loops (scheduled tools): what each runs, how often, and when it next fires.",
    skillId: "core",
    input_schema: { type: "object", properties: {} },
    async run(_args, cctx) {
      const jobs = cctx.app.store.listCopilotJobs().map((j) => ({
        id: j.id,
        title: j.title || j.tool,
        tool: j.tool,
        everyMinutes: Math.round(j.intervalSec / 60),
        reportMode: j.reportMode,
        enabled: j.enabled,
        nextRun: new Date(j.nextRun).toLocaleString(),
        lastSummary: j.lastSummary,
      }));
      return { ok: true, summary: `${jobs.length} scheduled loop${jobs.length === 1 ? "" : "s"}.`, data: jobs };
    },
  },
  {
    name: "schedule_cancel",
    description: "Cancel (delete) a scheduled loop by its id. Run schedule_list first to find the id.",
    skillId: "core",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The loop id (cj_…)" } }, required: ["id"] },
    async run(args, cctx) {
      const id = typeof args?.id === "string" ? args.id : "";
      const job = id ? cctx.app.store.getCopilotJob(id) : undefined;
      if (!job) return { ok: false, summary: `No scheduled loop with id "${id}".` };
      cctx.app.store.deleteCopilotJob(id);
      return { ok: true, summary: `Cancelled loop "${job.title || job.tool}".` };
    },
  },
];
