import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContext, type AppContext } from "../context.js";
import { createCopilotScheduler, shouldReport } from "./scheduler.js";
import type { CopilotJob } from "../types.js";

const NOW = 1_900_000_000_000;
let app: AppContext;
beforeEach(() => { app = createContext(":memory:"); });
afterEach(() => { app.pending.stop(); });

const job = (over: Partial<CopilotJob> = {}): CopilotJob => ({
  id: "cj_x", title: "t", tool: "board_list", args: {}, intervalSec: 60, reportMode: "always",
  enabled: true, nextRun: NOW, lastRun: null, lastSummary: null, createdAt: NOW, updatedAt: NOW, ...over,
});

describe("job persistence", () => {
  it("creates a job with a cj_ id and a default nextRun", () => {
    const j = app.store.createCopilotJob({ tool: "email_check", args: { provider: "gmail" }, intervalSec: 1800 });
    expect(j.id).toMatch(/^cj_/);
    expect(j.enabled).toBe(true);
    expect(j.nextRun).toBeGreaterThan(Date.now());
    expect(j.args).toEqual({ provider: "gmail" });
  });

  it("dueCopilotJobs returns only enabled, past-due jobs", () => {
    const due = app.store.createCopilotJob({ tool: "board_list", intervalSec: 60, nextRun: NOW - 1000 });
    app.store.createCopilotJob({ tool: "board_list", intervalSec: 60, nextRun: NOW + 60_000 }); // future
    const disabled = app.store.createCopilotJob({ tool: "board_list", intervalSec: 60, nextRun: NOW - 1000 });
    app.store.updateCopilotJob(disabled.id, { enabled: false });
    const ids = app.store.dueCopilotJobs(NOW).map((j) => j.id);
    expect(ids).toEqual([due.id]);
  });

  it("markCopilotJobRun advances nextRun and records the summary", () => {
    const j = app.store.createCopilotJob({ tool: "board_list", intervalSec: 60, nextRun: NOW });
    app.store.markCopilotJobRun(j.id, { now: NOW, nextRun: NOW + 60_000, summary: "0 cards" });
    const got = app.store.getCopilotJob(j.id)!;
    expect(got.nextRun).toBe(NOW + 60_000);
    expect(got.lastSummary).toBe("0 cards");
    expect(got.lastRun).toBe(NOW);
  });
});

describe("shouldReport", () => {
  it("never reports on failure", () => { expect(shouldReport(job(), { ok: false, summary: "x" })).toBe(false); });
  it("always mode always reports a success", () => { expect(shouldReport(job({ reportMode: "always" }), { ok: true, summary: "x" })).toBe(true); });
  it("on-change reports only when the summary differs", () => {
    expect(shouldReport(job({ reportMode: "on-change", lastSummary: "same" }), { ok: true, summary: "same" })).toBe(false);
    expect(shouldReport(job({ reportMode: "on-change", lastSummary: "old" }), { ok: true, summary: "new" })).toBe(true);
  });
  it("on-find reports only when data has items", () => {
    expect(shouldReport(job({ reportMode: "on-find" }), { ok: true, summary: "x", data: [] })).toBe(false);
    expect(shouldReport(job({ reportMode: "on-find" }), { ok: true, summary: "x", data: [1] })).toBe(true);
  });
});

describe("scheduler tick", () => {
  it("runs a due job, delivers a report, and advances nextRun", async () => {
    const sched = createCopilotScheduler(app);
    const j = app.store.createCopilotJob({ title: "Board check", tool: "board_list", intervalSec: 60, reportMode: "always", nextRun: NOW - 1000 });
    await sched.tick(NOW);

    expect(app.store.listNotifications().length).toBe(1);
    const after = app.store.getCopilotJob(j.id)!;
    expect(after.nextRun).toBe(NOW + 60_000);
    expect(after.lastSummary).toContain("card");
  });

  it("on-change doesn't re-report an unchanged result", async () => {
    const sched = createCopilotScheduler(app);
    const j = app.store.createCopilotJob({ tool: "board_list", intervalSec: 60, reportMode: "on-change", nextRun: NOW - 1000 });
    await sched.tick(NOW);                 // first run reports the baseline
    expect(app.store.listNotifications().length).toBe(1);
    await sched.tick(app.store.getCopilotJob(j.id)!.nextRun); // same board → no new report
    expect(app.store.listNotifications().length).toBe(1);
  });

  it("never auto-runs a dangerous tool (and doesn't report it), but still advances", async () => {
    const sched = createCopilotScheduler(app);
    const j = app.store.createCopilotJob({ tool: "terminal_send", args: { terminalId: "x", text: "rm -rf /" }, intervalSec: 60, reportMode: "always", nextRun: NOW - 1000 });
    await sched.tick(NOW);
    expect(app.store.listNotifications().length).toBe(0);  // not reported
    const after = app.store.getCopilotJob(j.id)!;
    expect(after.nextRun).toBe(NOW + 60_000);              // still advanced
    expect(after.lastSummary?.toLowerCase()).toContain("dangerous");
  });
});
