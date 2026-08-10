import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type LightMyRequestResponse } from "fastify";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { projectPathToFolderName } from "../claude/paths.js";
import { resumeCommand } from "../gui/switch.js";
import type { AppContext } from "../context.js";
import type { GuiSession } from "../gui/session.js";
import type { GuiModel, GuiSessionState } from "../gui/types.js";
import { DEFAULT_GUI_CONFIG, type GuiConfig } from "../gui/config.js";
import { guiRoutes } from "./gui.js";

const FOLDER = "/work/gui-routes";
const SESSION_ID = "aaaabbbb-1111-2222-3333-444455556666";

let home: string;
let realHome: string | undefined;

function projectDir(): string {
  return path.join(home, ".claude", "projects", projectPathToFolderName(FOLDER));
}

/** A transcript whose tail classifies as `active` — i.e. Claude is mid-turn. */
function writeActiveTranscript(): void {
  mkdirSync(projectDir(), { recursive: true });
  writeFileSync(
    path.join(projectDir(), `${SESSION_ID}.jsonl`),
    JSON.stringify({ type: "user", message: { role: "user", content: "keep going" }, timestamp: new Date().toISOString() }) + "\n",
  );
}

function build() {
  const calls: string[][] = [];
  const run = vi.fn(async (args: string[]) => { calls.push(args); return ""; });
  const stopped: string[] = [];
  let session: GuiSession | undefined;
  let models: GuiModel[] = [];
  // What setConfig was asked to apply, and whether the fake CLI accepts it (a rejection keeps the
  // session's own config, exactly like a bad model id does in real life).
  const applied: GuiConfig[] = [];
  let rejectConfig = false;

  const gui = {
    get: () => session,
    stop: async (terminalId: string) => { stopped.push(terminalId); session = undefined; },
    models: async () => (session ? models : []),
  };
  const ctx = { store: createStore(":memory:"), tmux: createTmuxController(run), gui } as unknown as AppContext;

  const app = Fastify();
  app.register(async (a) => guiRoutes(a, ctx));

  return {
    app, ctx, calls, stopped, applied,
    setModels: (list: GuiModel[]) => { models = list; },
    rejectConfigChanges: () => { rejectConfig = true; },
    setSession: (state: GuiSessionState, config: GuiConfig = { ...DEFAULT_GUI_CONFIG }) => {
      let current = config;
      session = {
        state: () => state,
        config: () => current,
        setConfig: async (next: GuiConfig) => {
          applied.push(next);
          if (!rejectConfig) current = next;
          return current;
        },
      } as unknown as GuiSession;
    },
  };
}

const model = (over: Partial<GuiModel> = {}): GuiModel => ({
  value: "sonnet", displayName: "Sonnet", description: "Balanced",
  supportsEffort: true, effortLevels: ["low", "medium", "high"],
  supportsFastMode: false, supportsContext1m: false, base: "sonnet", ...over,
});

type Harness = ReturnType<typeof build>;

/** A workspace + one terminal in it, with whatever GUI fields the test needs. */
function makeTerminal(h: Harness, over: { launchCommandOverride?: string | null; mode?: "tmux" | "gui"; agentSessionId?: string | null } = {}) {
  const ws = h.ctx.store.createWorkspace({ name: "A", folder: FOLDER, launchCommand: "claude", color: null });
  const term = h.ctx.store.createTerminal({
    workspaceId: ws.id,
    title: "T1",
    color: null,
    tmuxSession: `tr_${ws.id}_x`,
    launchCommandOverride: over.launchCommandOverride ?? null,
    mode: over.mode ?? "tmux",
    agentSessionId: over.agentSessionId ?? null,
  });
  return { ws, term };
}

let h: Harness;

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-gui-routes-"));
  process.env.HOME = home;
  h = build();
});

afterEach(async () => {
  await h.app.close();
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

const setMode = (id: string, payload: object): Promise<LightMyRequestResponse> =>
  h.app.inject({ method: "POST", url: `/api/terminals/${id}/mode`, payload });
const getGui = (id: string): Promise<LightMyRequestResponse> =>
  h.app.inject({ method: "GET", url: `/api/terminals/${id}/gui` });
const getModels = (id: string): Promise<LightMyRequestResponse> =>
  h.app.inject({ method: "GET", url: `/api/terminals/${id}/gui/models` });
const patchConfig = (id: string, payload: object): Promise<LightMyRequestResponse> =>
  h.app.inject({ method: "PATCH", url: `/api/terminals/${id}/gui/config`, payload });

describe("GET /api/terminals/:id/gui", () => {
  it("reports the stored mode and session id, with no live session", async () => {
    const { term } = makeTerminal(h, { mode: "gui", agentSessionId: SESSION_ID });
    const res = await getGui(term.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      mode: "gui", sessionId: SESSION_ID, running: false, state: "idle", config: DEFAULT_GUI_CONFIG,
    });
  });

  it("reports tmux + null session for a classic terminal", async () => {
    const { term } = makeTerminal(h);
    expect((await getGui(term.id)).json()).toEqual({
      mode: "tmux", sessionId: null, running: false, state: "idle", config: DEFAULT_GUI_CONFIG,
    });
  });

  it("prefers the live session's config over the stored row", async () => {
    const { term } = makeTerminal(h, { mode: "gui", agentSessionId: SESSION_ID });
    const live: GuiConfig = { model: "opus", effort: "max", permissionMode: "auto", fastMode: true };
    h.setSession("running", live);
    expect((await getGui(term.id)).json().config).toEqual(live);
  });

  it("reports a live session as running, and a stopped one as not", async () => {
    const { term } = makeTerminal(h, { mode: "gui", agentSessionId: SESSION_ID });
    h.setSession("running");
    expect((await getGui(term.id)).json()).toMatchObject({ running: true, state: "running" });
    h.setSession("stopped");
    expect((await getGui(term.id)).json()).toMatchObject({ running: false, state: "stopped" });
  });

  it("404s an unknown terminal", async () => {
    const res = await getGui("tm_nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "terminal not found" });
  });
});

describe("GET /api/terminals/:id/gui/models", () => {
  it("404s an unknown terminal", async () => {
    const res = await getModels("tm_nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "terminal not found" });
  });

  it("returns an empty roster when no session is live", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    const res = await getModels(term.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ models: [] });
  });

  it("returns whatever the CLI reported, verbatim", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    const list = [model(), model({ value: "opus[1m]", base: "opus", supportsContext1m: true, effortLevels: ["high", "xhigh", "max"] })];
    h.setSession("running");
    h.setModels(list);
    expect((await getModels(term.id)).json()).toEqual({ models: list });
  });
});

describe("PATCH /api/terminals/:id/gui/config", () => {
  it("404s an unknown terminal", async () => {
    const res = await patchConfig("tm_nope", { model: "sonnet" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "terminal not found" });
  });

  it("400s a body the composer could never have sent", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    const bad = [{ effort: "turbo" }, { permissionMode: "yolo" }, { fastMode: "yes" }, { model: "" }, { model: 5 }];
    for (const payload of bad) {
      const res = await patchConfig(term.id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "invalid gui config" });
    }
    expect(h.ctx.store.getTerminal(term.id)!.guiConfig).toEqual(DEFAULT_GUI_CONFIG);
  });

  it("merges a one-pill patch over the current config and persists it", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });

    const first = await patchConfig(term.id, { model: "sonnet" });
    expect(first.statusCode).toBe(200);
    expect(first.json().config).toEqual({ ...DEFAULT_GUI_CONFIG, model: "sonnet" });

    // the second patch touches only the effort — the model from the first one survives
    const second = await patchConfig(term.id, { effort: "ultracode" });
    expect(second.json().config).toEqual({ ...DEFAULT_GUI_CONFIG, model: "sonnet", effort: "ultracode" });
    expect(h.ctx.store.getTerminal(term.id)!.guiConfig)
      .toEqual({ ...DEFAULT_GUI_CONFIG, model: "sonnet", effort: "ultracode" });
  });

  it("clears the model with an explicit null, back to the CLI's own default", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    await patchConfig(term.id, { model: "opus" });
    expect((await patchConfig(term.id, { model: null })).json().config.model).toBeNull();
    expect(h.ctx.store.getTerminal(term.id)!.guiConfig.model).toBeNull();
  });

  it("leaves everything alone for an empty patch", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    await patchConfig(term.id, { permissionMode: "auto", fastMode: true });
    const res = await patchConfig(term.id, {});
    expect(res.json().config).toEqual({ ...DEFAULT_GUI_CONFIG, permissionMode: "auto", fastMode: true });
  });

  it("makes the choice sticky, so the next new chat inherits it", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    await patchConfig(term.id, { model: "opus", effort: "xhigh" });
    expect(h.ctx.store.getGuiDefaults()).toEqual({ ...DEFAULT_GUI_CONFIG, model: "opus", effort: "xhigh" });
  });

  it("applies the change to the live session before persisting it", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    h.setSession("idle");

    const res = await patchConfig(term.id, { permissionMode: "full-access" });
    expect(res.json().config).toEqual({ ...DEFAULT_GUI_CONFIG, permissionMode: "full-access" });
    expect(h.applied).toEqual([{ ...DEFAULT_GUI_CONFIG, permissionMode: "full-access" }]);
    expect(h.ctx.store.getTerminal(term.id)!.guiConfig.permissionMode).toBe("full-access");
  });

  it("persists what the session reports, not what was asked, when the CLI refuses the switch", async () => {
    const { term } = makeTerminal(h, { mode: "gui" });
    h.setSession("idle");
    h.rejectConfigChanges();

    const res = await patchConfig(term.id, { model: "not-a-real-model" });
    expect(res.statusCode).toBe(200);
    // the session kept its own config, so the row and the sticky default must too — a rejected
    // switch that still wrote the request would leave the UI showing a model nothing is running
    expect(res.json().config).toEqual(DEFAULT_GUI_CONFIG);
    expect(h.ctx.store.getTerminal(term.id)!.guiConfig).toEqual(DEFAULT_GUI_CONFIG);
    expect(h.ctx.store.getGuiDefaults()).toEqual(DEFAULT_GUI_CONFIG);
  });
});

describe("POST /api/terminals/:id/mode — validation", () => {
  it("404s an unknown terminal", async () => {
    const res = await setMode("tm_nope", { mode: "gui" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "terminal not found" });
  });

  it("400s an unknown mode, a missing mode, and a non-string mode", async () => {
    const { term } = makeTerminal(h);
    for (const payload of [{ mode: "banana" }, {}, { mode: 1 }, { mode: null }]) {
      const res = await setMode(term.id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "mode must be 'tmux' or 'gui'" });
    }
    expect(h.ctx.store.getTerminal(term.id)!.mode).toBe("tmux");
  });

  it("is a no-op when the terminal is already in the requested mode", async () => {
    const { term } = makeTerminal(h, { launchCommandOverride: resumeCommand(SESSION_ID) });
    const res = await setMode(term.id, { mode: "tmux" });
    expect(res.statusCode).toBe(200);
    expect(res.json().terminal.mode).toBe("tmux");
    // nothing was typed into the pane and the agent was never touched
    expect(h.calls).toEqual([]);
    expect(h.stopped).toEqual([]);
  });
});

describe("POST /api/terminals/:id/mode — switching", () => {
  it("tmux → gui persists mode + session id and quits the agent in the pane", async () => {
    const { term } = makeTerminal(h, { launchCommandOverride: resumeCommand(SESSION_ID) });

    const res = await setMode(term.id, { mode: "gui" });
    expect(res.statusCode).toBe(200);
    expect(res.json().terminal).toMatchObject({ mode: "gui", agentSessionId: SESSION_ID });
    expect(h.ctx.store.getTerminal(term.id)).toMatchObject({ mode: "gui", agentSessionId: SESSION_ID });

    const keys = h.calls.filter((c) => c[0] === "send-keys").map((c) => c.slice(2));
    expect(keys).toEqual([[term.tmuxSession, "C-c"], [term.tmuxSession, "C-c"], [term.tmuxSession, "C-d"]]);
  });

  it("gui → tmux stops the GUI session and resumes it in the pane", async () => {
    const { term } = makeTerminal(h, { mode: "gui", agentSessionId: SESSION_ID });

    const res = await setMode(term.id, { mode: "tmux" });
    expect(res.statusCode).toBe(200);
    expect(res.json().terminal.mode).toBe("tmux");
    expect(h.stopped).toEqual([term.id]);
    expect(h.calls.find((c) => c[0] === "send-keys")).toEqual(["send-keys", "-t", term.tmuxSession, resumeCommand(SESSION_ID), "Enter"]);
  });

  it("409s with the reason when the agent is mid-turn, leaving the mode alone", async () => {
    writeActiveTranscript();
    const { term } = makeTerminal(h, { launchCommandOverride: resumeCommand(SESSION_ID) });

    const res = await setMode(term.id, { mode: "gui" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/still working/i);
    expect(h.ctx.store.getTerminal(term.id)).toMatchObject({ mode: "tmux", agentSessionId: null });
    expect(h.calls.filter((c) => c[0] === "send-keys")).toEqual([]);
  });

  it("500s when the switch fails for any other reason", async () => {
    const { term } = makeTerminal(h, { mode: "gui", agentSessionId: SESSION_ID });
    h.ctx.tmux.sendKeys = async () => { throw new Error("tmux is gone"); };

    const res = await setMode(term.id, { mode: "tmux" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "tmux is gone" });
  });
});
