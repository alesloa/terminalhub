import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContext, type AppContext } from "../../context.js";
import { coreTools } from "./index.js";
import type { CopilotCtx } from "../types.js";

let app: AppContext;
let cctx: CopilotCtx;

beforeEach(() => {
  app = createContext(":memory:");
  cctx = { app, settings: app.store.getCopilotSettings(), actor: "user" };
});
afterEach(() => { app.pending.stop(); });

const tool = (name: string) => {
  const t = coreTools.find((x) => x.name === name);
  if (!t) throw new Error(`no such tool: ${name}`);
  return t;
};
const run = (name: string, args: unknown) => tool(name).run(args, cctx);

describe("notes tools", () => {
  it("note_add writes a note that note_list then sees", async () => {
    const r = await run("note_add", { title: "Groceries", content: "milk, eggs" });
    expect(r.ok).toBe(true);
    expect(app.store.listNotes()).toHaveLength(1);
    const list = await run("note_list", {});
    expect((list.data as any[]).map((n) => n.title)).toContain("Groceries");
  });

  it("note_add requires content", async () => {
    expect((await run("note_add", { title: "x" })).ok).toBe(false);
  });
});

describe("board tools", () => {
  it("board_add_card then board_list reflects it", async () => {
    const r = await run("board_add_card", { title: "Ship copilot", column: "doing" });
    expect(r.ok).toBe(true);
    const cards = app.store.listBoardCards();
    expect(cards).toHaveLength(1);
    expect(cards[0].column).toBe("doing");
    const list = await run("board_list", {});
    expect(list.ok).toBe(true);
  });

  it("board_add_card defaults to the todo column", async () => {
    await run("board_add_card", { title: "later" });
    expect(app.store.listBoardCards()[0].column).toBe("todo");
  });

  it("board_move_card moves a card to a new column", async () => {
    await run("board_add_card", { title: "x" });
    const id = app.store.listBoardCards()[0].id;
    expect((await run("board_move_card", { id, column: "done" })).ok).toBe(true);
    expect(app.store.getBoardCard(id)?.column).toBe("done");
  });

  it("board_move_card on a missing card fails", async () => {
    expect((await run("board_move_card", { id: "nope", column: "done" })).ok).toBe(false);
  });

  it("board_add_card rejects an unknown column", async () => {
    expect((await run("board_add_card", { title: "x", column: "backlog" })).ok).toBe(false);
  });
});

describe("reminder tools", () => {
  it("reminder_set with inMinutes creates a pending reminder", async () => {
    const r = await run("reminder_set", { title: "standup", inMinutes: 30 });
    expect(r.ok).toBe(true);
    const list = app.store.listReminders({ status: ["pending"] });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("standup");
    expect(list[0].fireAt).toBeGreaterThan(Date.now());
  });

  it("reminder_set needs a time (inMinutes or atISO)", async () => {
    expect((await run("reminder_set", { title: "no time" })).ok).toBe(false);
  });

  it("reminder_list returns upcoming reminders", async () => {
    await run("reminder_set", { title: "soon", inMinutes: 10 });
    const r = await run("reminder_list", {});
    expect((r.data as any[]).map((x) => x.title)).toContain("soon");
  });
});

describe("alert tool", () => {
  it("send_alert publishes a notification frame", async () => {
    const frames: any[] = [];
    const unsub = app.notify.subscribe((f) => frames.push(f));
    const r = await run("send_alert", { text: "build done", level: "success" });
    unsub();
    expect(r.ok).toBe(true);
    expect(frames.some((f) => f.type === "notification" || f.text === "build done")).toBe(true);
  });
});

describe("canvas tools", () => {
  it("space_list includes the seeded Home space", async () => {
    const r = await run("space_list", {});
    expect(r.ok).toBe(true);
    expect((r.data as any[]).length).toBeGreaterThanOrEqual(1);
  });

  it("workspace_list returns an array", async () => {
    const r = await run("workspace_list", {});
    expect(Array.isArray(r.data)).toBe(true);
  });
});

describe("terminal tools", () => {
  it("terminal_list returns an array", async () => {
    expect(Array.isArray((await run("terminal_list", {})).data)).toBe(true);
  });

  it("terminal_send is flagged dangerous", () => {
    expect(tool("terminal_send").dangerous).toBe(true);
  });

  it("terminal_send on a missing terminal fails without touching tmux", async () => {
    expect((await run("terminal_send", { terminalId: "tm_ghost", text: "hi" })).ok).toBe(false);
  });
});

describe("schedule tools", () => {
  it("schedule_create puts a safe tool on a loop (cj_ job, default on-change)", async () => {
    const r = await run("schedule_create", { title: "Board watch", tool: "board_list", everyMinutes: 30 });
    expect(r.ok).toBe(true);
    const jobs = app.store.listCopilotJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toMatch(/^cj_/);
    expect(jobs[0].tool).toBe("board_list");
    expect(jobs[0].intervalSec).toBe(1800);
    expect(jobs[0].reportMode).toBe("on-change");
  });

  it("schedule_create rejects an interval under a minute", async () => {
    expect((await run("schedule_create", { tool: "board_list", everyMinutes: 0 })).ok).toBe(false);
  });

  it("schedule_create rejects an unknown tool", async () => {
    expect((await run("schedule_create", { tool: "no_such_tool", everyMinutes: 10 })).ok).toBe(false);
    expect(app.store.listCopilotJobs()).toHaveLength(0);
  });

  it("schedule_create refuses a dangerous tool", async () => {
    const r = await run("schedule_create", { tool: "terminal_send", args: { terminalId: "x", text: "ls" }, everyMinutes: 10 });
    expect(r.ok).toBe(false);
    expect(app.store.listCopilotJobs()).toHaveLength(0);
  });

  it("schedule_list shows a created loop and schedule_cancel removes it", async () => {
    await run("schedule_create", { tool: "board_list", everyMinutes: 5, reportMode: "always" });
    const list = await run("schedule_list", {});
    expect((list.data as any[])).toHaveLength(1);
    const id = (list.data as any[])[0].id;
    expect((await run("schedule_cancel", { id })).ok).toBe(true);
    expect(app.store.listCopilotJobs()).toHaveLength(0);
  });

  it("schedule_cancel on a missing loop fails", async () => {
    expect((await run("schedule_cancel", { id: "cj_ghost" })).ok).toBe(false);
  });
});
