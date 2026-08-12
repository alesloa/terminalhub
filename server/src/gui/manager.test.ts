import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GuiCommand, GuiModel, GuiSessionState } from "./types.js";

// The registry that keeps one live agent per terminal. What matters here is which agent it starts,
// when it refuses to reuse one, and that the CLI-wide caches never mix the two agents' answers.

interface FakeSession {
  kind: "claude" | "codex";
  terminalId: string;
  state: () => GuiSessionState;
  stop: () => Promise<void>;
  models: () => Promise<GuiModel[]>;
  commands: () => Promise<GuiCommand[]>;
}

const built: FakeSession[] = [];
const stopped: string[] = [];
/** Per-terminal knobs the fakes read, so a test can make a session look dead or answer a catalog. */
const states = new Map<string, GuiSessionState>();
const catalogs = new Map<string, GuiModel[]>();
const skills = new Map<string, GuiCommand[]>();

function fake(kind: "claude" | "codex", terminalId: string): FakeSession {
  const session: FakeSession = {
    kind, terminalId,
    state: () => states.get(terminalId) ?? "idle",
    stop: async () => { stopped.push(`${kind}:${terminalId}`); },
    models: async () => catalogs.get(terminalId) ?? [],
    commands: async () => skills.get(terminalId) ?? [],
  };
  built.push(session);
  return session;
}

vi.mock("./session.js", () => ({
  createGuiSession: (opts: { terminalId: string }) => fake("claude", opts.terminalId),
}));
vi.mock("./codex/session.js", () => ({
  createCodexGuiSession: (opts: { terminalId: string }) => fake("codex", opts.terminalId),
}));

const { createGuiManager } = await import("./manager.js");
const { DEFAULT_GUI_CONFIG } = await import("./config.js");

type Manager = ReturnType<typeof createGuiManager>;

const ensure = (m: Manager, agent: "claude" | "codex", terminalId = "tm_1") =>
  m.ensure({ agent, terminalId, cwd: "/w", config: { ...DEFAULT_GUI_CONFIG } }) as unknown as FakeSession;

const model = (value: string): GuiModel => ({
  value, displayName: value, description: "", supportsEffort: false, effortLevels: [],
  supportsFastMode: false, supportsContext1m: false, base: value,
});

beforeEach(() => {
  built.length = 0;
  stopped.length = 0;
  states.clear();
  catalogs.clear();
  skills.clear();
});

describe("gui manager", () => {
  it("starts the agent the caller asked for", () => {
    const m = createGuiManager();
    expect(ensure(m, "claude").kind).toBe("claude");
    expect(ensure(m, "codex", "tm_2").kind).toBe("codex");
  });

  it("hands the same live session back rather than starting a second agent", () => {
    const m = createGuiManager();
    expect(ensure(m, "codex")).toBe(ensure(m, "codex"));
    expect(built).toHaveLength(1);
  });

  it("replaces a session that has already stopped or failed", async () => {
    const m = createGuiManager();
    const first = ensure(m, "claude");
    states.set("tm_1", "error");

    const second = ensure(m, "claude");
    expect(second).not.toBe(first);
    // The corpse is torn down, not left holding the terminal.
    await Promise.resolve();
    expect(stopped).toEqual(["claude:tm_1"]);
  });

  it("swaps the agent when a terminal is re-pointed at a different CLI", async () => {
    const m = createGuiManager();
    ensure(m, "claude");
    const next = ensure(m, "codex");

    expect(next.kind).toBe("codex");
    await Promise.resolve();
    expect(stopped).toEqual(["claude:tm_1"]);
    expect(m.get("tm_1")).toBe(next as never);
  });

  it("never serves one agent's model catalog to the other", async () => {
    const m = createGuiManager();
    ensure(m, "claude", "tm_claude");
    ensure(m, "codex", "tm_codex");
    catalogs.set("tm_claude", [model("opus")]);
    catalogs.set("tm_codex", [model("gpt-5.6-sol")]);

    expect((await m.models("tm_claude", "claude")).map((x) => x.value)).toEqual(["opus"]);
    expect((await m.models("tm_codex", "codex")).map((x) => x.value)).toEqual(["gpt-5.6-sol"]);
    // Cached per agent, so a second terminal on the same CLI answers without asking its session.
    catalogs.clear();
    expect((await m.models("tm_codex", "codex")).map((x) => x.value)).toEqual(["gpt-5.6-sol"]);
  });

  it("does not cache an empty answer — the agent may just not be up yet", async () => {
    const m = createGuiManager();
    ensure(m, "codex");
    expect(await m.models("tm_1", "codex")).toEqual([]);

    catalogs.set("tm_1", [model("gpt-5.6-sol")]);
    expect((await m.models("tm_1", "codex")).map((x) => x.value)).toEqual(["gpt-5.6-sol"]);
  });

  it("caches slash commands per agent too", async () => {
    const m = createGuiManager();
    ensure(m, "codex");
    skills.set("tm_1", [{ name: "review", description: "", argumentHint: "" }]);

    expect(await m.commands("tm_1", "codex")).toHaveLength(1);
    skills.clear();
    expect(await m.commands("tm_1", "codex")).toHaveLength(1);
    // A different agent has its own list, and no session to ask on this terminal id.
    expect(await m.commands("tm_1", "claude")).toEqual([]);
  });

  it("answers with nothing for a terminal that has no session", async () => {
    const m = createGuiManager();
    expect(await m.models("tm_missing", "codex")).toEqual([]);
    expect(m.get("tm_missing")).toBeUndefined();
  });

  it("stops everything on shutdown", async () => {
    const m = createGuiManager();
    ensure(m, "claude", "tm_a");
    ensure(m, "codex", "tm_b");

    await m.stopAll();
    expect(stopped.sort()).toEqual(["claude:tm_a", "codex:tm_b"]);
    expect(m.get("tm_a")).toBeUndefined();
  });

  it("is safe to stop a terminal that was never started", async () => {
    const m = createGuiManager();
    await m.stop("tm_nothing");
    expect(stopped).toEqual([]);
  });
});
