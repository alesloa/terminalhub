import type { AppContext } from "../context.js";
import { createRegistry } from "./registry.js";
import { collectTools } from "./skills/registry.js";
import { notifyCategory } from "../notify/bus.js";
import type { CopilotJob, CopilotSettings } from "../types.js";
import type { ToolResult } from "./types.js";

const DEFAULT_TICK_MS = 30_000;

export interface CopilotScheduler {
  start(): void;
  stop(): void;
  tick(now: number): Promise<void>; // exposed for tests + boot catch-up
}

// Runs scheduled copilot loops: every tick, each due job runs its single tool under the `scheduler`
// actor (so dangerous tools are refused), reports per its reportMode, and advances nextRun. Mirrors
// the reminder scheduler's polling model. Failures never nag (a transient mail outage shouldn't spam).
export function createCopilotScheduler(app: AppContext, opts: { tickMs?: number } = {}): CopilotScheduler {
  const tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runJob(job: CopilotJob, now: number) {
    const reg = createRegistry(collectTools(app));
    const def = reg.get(job.tool);
    let result: ToolResult;
    if (!def) {
      result = { ok: false, summary: `Tool "${job.tool}" is no longer available.` };
    } else if (def.dangerous) {
      result = { ok: false, summary: `Skipped "${job.tool}" — dangerous tools aren't auto-run on a schedule.` };
    } else {
      const cctx = { app, settings: app.store.getCopilotSettings(), actor: "scheduler" as const };
      try { result = await reg.run(job.tool, job.args, cctx); }
      catch (e) { result = { ok: false, summary: e instanceof Error ? e.message : String(e) }; }
    }
    if (shouldReport(job, result)) await deliver(app, job, result, now);
    app.store.markCopilotJobRun(job.id, { now, nextRun: now + job.intervalSec * 1000, summary: result.summary });
  }

  async function tick(now: number) {
    for (const job of app.store.dueCopilotJobs(now)) {
      try { await runJob(job, now); } catch { /* one job's failure shouldn't break the tick */ }
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => { tick(Date.now()).catch(() => { /* swallow — next tick retries */ }); }, tickMs);
      if (typeof timer.unref === "function") timer.unref(); // don't keep the process alive for the poll
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    tick,
  };
}

// When to ping the user. Never on failure (don't nag on a transient outage). on-change compares to
// the previous run's summary; on-find pings only when the tool found items (a non-empty data array).
export function shouldReport(job: CopilotJob, r: ToolResult): boolean {
  if (!r.ok) return false;
  if (job.reportMode === "always") return true;
  if (job.reportMode === "on-change") return r.summary !== job.lastSummary;
  if (job.reportMode === "on-find") return Array.isArray(r.data) && r.data.length > 0;
  return false;
}

// Deliver a report through the configured channels (toast + notification center, optional voice,
// optional Pushover) — the same delivery the reminder scheduler uses.
async function deliver(app: AppContext, job: CopilotJob, r: ToolResult, now: number) {
  const settings: CopilotSettings = app.store.getCopilotSettings();
  const channels = settings.reportChannels;
  const title = `Copilot — ${job.title || job.tool}`;
  const text = r.summary;
  const level = "info" as const;

  let pushoverAttempted = false;
  let pushoverOk: boolean | null = null;
  if (channels.includes("pushover") && app.pushover.isConfigured()) {
    pushoverAttempted = true;
    const res = await app.pushover.send({ message: text, title });
    pushoverOk = res.ok;
  }

  const note = app.store.createNotification({
    title, body: text, level, category: notifyCategory(level, "notify"),
    pushover: pushoverAttempted, pushoverOk, firedAt: now,
  });
  if (channels.includes("toast")) {
    app.notify.publish({ id: note.id, title, text, level, category: note.category, source: "notify", speak: channels.includes("voice"), ts: now });
  }
}
