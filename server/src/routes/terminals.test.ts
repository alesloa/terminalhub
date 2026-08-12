import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../db/store.js";
import { createTmuxController } from "../tmux/controller.js";
import { createClipController } from "../clip/controller.js";
import { workspaceRoutes } from "./workspaces.js";
import { terminalRoutes } from "./terminals.js";

function build() {
  const calls: string[][] = [];
  const live = new Set<string>();
  let paneCwd = "";
  const run = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args[0] === "new-session") live.add(args[args.indexOf("-s") + 1]);
    if (args[0] === "kill-session") live.delete(args[args.indexOf("-t") + 1]);
    if (args[0] === "list-sessions") return [...live].join("\n");
    if (args[0] === "display-message") return paneCwd; // #{pane_current_path}
    if (args[0] === "capture-pane") return "old line\nnew line\n";
    return "";
  });
  const sysPromptDir = mkdtempSync(join(tmpdir(), "tr-sysprompt-"));
  const ctx = { store: createStore(":memory:"), tmux: createTmuxController(run), clip: createClipController(), sysPromptDir };
  const app = Fastify();
  app.register(async a => workspaceRoutes(a, ctx));
  app.register(async a => terminalRoutes(a, ctx));
  return { app, ctx, calls, sysPromptDir, setPaneCwd: (p: string) => { paneCwd = p; } };
}

describe("terminal routes", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("creating a terminal starts a tmux session in the workspace folder and runs launch cmd", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "claude", color: null });
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} });
    expect(res.statusCode).toBe(200);
    const term = res.json().terminal;
    expect(term.tmuxSession).toBe(`tr_${ws.id}_${term.id}`);
    // a new-session call happened in /work, then a send-keys with claude
    const newSess = h.calls.find(c => c[0] === "new-session")!;
    expect(newSess).toContain("/work");
    const sendKeys = h.calls.find(c => c[0] === "send-keys")!;
    expect(sendKeys).toContain("claude");
  });

  // A new terminal opens on the last composer picks — but only the ones made on the CLI it is about
  // to run. Seeding a Codex chat with Claude's model names a model Codex has never heard of: the
  // picker matches nothing, the reasoning menu has no levels to show, and turns are refused.
  it("seeds the composer from the picks made on the agent it launches", async () => {
    h.ctx.store.setGuiDefaults("claude", { model: "opus", effort: "xhigh", permissionMode: "auto", fastMode: true });
    h.ctx.store.setGuiDefaults("codex", { model: "gpt-5.6-sol", effort: "ultra", permissionMode: "auto", fastMode: false });
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "claude", color: null });

    const claude = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: { mode: "gui" } })).json().terminal;
    const codex = (await h.app.inject({
      method: "POST", url: `/api/workspaces/${ws.id}/terminals`,
      payload: { mode: "gui", launchCommandOverride: "codex" },
    })).json().terminal;

    expect(claude.guiConfig.model).toBe("opus");
    expect(codex.guiConfig).toEqual({ model: "gpt-5.6-sol", effort: "ultra", permissionMode: "auto", fastMode: false });
  });

  it("seeds from the workspace's agent when the terminal names no command of its own", async () => {
    h.ctx.store.setGuiDefaults("codex", { model: "gpt-5.6-sol", effort: null, permissionMode: "auto", fastMode: false });
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "codex", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    expect(term.guiConfig.model).toBe("gpt-5.6-sol");
  });

  it("empty launch command does NOT send keys", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} });
    expect(h.calls.find(c => c[0] === "send-keys")).toBeUndefined();
  });

  it("accepts a kickoff command and still creates the terminal + launches", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "claude", color: null });
    const res = await h.app.inject({
      method: "POST", url: `/api/workspaces/${ws.id}/terminals`,
      payload: { launchCommandOverride: "claude", title: "Claude Loop", kickoff: "/loop 5m do thing" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().terminal.title).toBe("Claude Loop");
    // launch keys went out synchronously; the kickoff itself fires async after the agent is detected.
    expect(h.calls.find(c => c[0] === "send-keys" && c.includes("claude"))).toBeTruthy();
  });

  it("PATCH sets and clears a terminal's icon", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    expect(term.icon).toBeNull();
    const set = await h.app.inject({ method: "PATCH", url: `/api/terminals/${term.id}`, payload: { icon: "flame" } });
    expect(set.statusCode).toBe(200);
    expect(set.json().terminal.icon).toBe("flame");
    const clear = await h.app.inject({ method: "PATCH", url: `/api/terminals/${term.id}`, payload: { icon: null } });
    expect(clear.json().terminal.icon).toBeNull();
  });

  it("new terminals get contiguous positions in creation order", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const mk = () => h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} }).then(r => r.json().terminal);
    const a = await mk(), b = await mk(), c = await mk();
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
  });

  it("POST .../move reorders the terminal and renumbers positions", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const mk = () => h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} }).then(r => r.json().terminal);
    const a = await mk(), b = await mk(), c = await mk(); // order: a, b, c
    // move c to the front (index 0)
    const res = await h.app.inject({ method: "POST", url: `/api/terminals/${c.id}/move`, payload: { index: 0 } });
    expect(res.statusCode).toBe(200);
    const order = h.ctx.store.listTerminals(ws.id);
    expect(order.map(t => t.id)).toEqual([c.id, a.id, b.id]);
    expect(order.map(t => t.position)).toEqual([0, 1, 2]);
  });

  it("move rejects a bad index and 404s an unknown terminal", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    expect((await h.app.inject({ method: "POST", url: `/api/terminals/${term.id}/move`, payload: { index: -1 } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "POST", url: `/api/terminals/tm_nope/move`, payload: { index: 0 } })).statusCode).toBe(404);
  });

  it("deleting a terminal closes the position gap for the rest", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const mk = () => h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} }).then(r => r.json().terminal);
    const a = await mk(), b = await mk(), c = await mk();
    await h.app.inject({ method: "DELETE", url: `/api/terminals/${b.id}` });
    const order = h.ctx.store.listTerminals(ws.id);
    expect(order.map(t => t.id)).toEqual([a.id, c.id]);
    expect(order.map(t => t.position)).toEqual([0, 1]);
  });

  it("GET .../scrollback returns the captured pane text and passes a line cap through", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    const res = await h.app.inject({ method: "GET", url: `/api/terminals/${term.id}/scrollback?lines=500` });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toBe("old line\nnew line\n");
    // the full-history capture-pane (-S/-E) carried the cap as -500
    const cap = h.calls.find(c => c[0] === "capture-pane" && c.includes("-J"))!;
    expect(cap).toContain("-500");
  });

  it("scrollback 404s an unknown terminal and rejects a bad line cap", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    expect((await h.app.inject({ method: "GET", url: `/api/terminals/tm_nope/scrollback` })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "GET", url: `/api/terminals/${term.id}/scrollback?lines=-5` })).statusCode).toBe(400);
  });

  it("GET .../preview returns the captured visible screen (ANSI) and 404s an unknown terminal", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    const res = await h.app.inject({ method: "GET", url: `/api/terminals/${term.id}/preview` });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("old line\nnew line\n");
    // it used capture-pane -e -p (ANSI visible screen), not the -J scrollback variant
    const cap = h.calls.find(c => c[0] === "capture-pane" && c.includes("-e"))!;
    expect(cap).toEqual(["capture-pane", "-e", "-p", "-t", term.tmuxSession]);
    expect((await h.app.inject({ method: "GET", url: `/api/terminals/tm_nope/preview` })).statusCode).toBe(404);
  });

  it("POST .../clear-history wipes the tmux scrollback and 404s an unknown terminal", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    const res = await h.app.inject({ method: "POST", url: `/api/terminals/${term.id}/clear-history` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(h.calls.find(c => c[0] === "clear-history" && c.includes(term.tmuxSession))).toBeTruthy();
    expect((await h.app.inject({ method: "POST", url: `/api/terminals/tm_nope/clear-history` })).statusCode).toBe(404);
  });

  it("deleting a terminal kills its session", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    const del = await h.app.inject({ method: "DELETE", url: `/api/terminals/${term.id}` });
    expect(del.statusCode).toBe(200);
    expect(h.calls.find(c => c[0] === "kill-session" && c.includes(term.tmuxSession))).toBeTruthy();
  });
});

describe("terminal routes — system prompts", () => {
  let h: ReturnType<typeof build>;
  beforeEach(() => { h = build(); });

  it("launches Claude with --append-system-prompt-file and the merged global⊕workspace⊕terminal prompt", async () => {
    h.ctx.store.setAgentSystemPrompts({ claude: "GLOBAL." });
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "claude", color: null });
    h.ctx.store.updateWorkspace(ws.id, { systemPrompt: { text: "WORKSPACE.", includeGlobal: true } });

    const res = await h.app.inject({
      method: "POST", url: `/api/workspaces/${ws.id}/terminals`,
      payload: { agentId: "claude", launchCommandOverride: "claude", systemPrompt: { text: "TERMINAL.", includeParent: true } },
    });
    expect(res.statusCode).toBe(200);
    const term = res.json().terminal;
    // the terminal-level prompt was persisted
    expect(h.ctx.store.getTerminal(term.id)!.systemPrompt).toEqual({ text: "TERMINAL.", includeParent: true });

    // launch keys carry the flag pointing at the per-terminal file
    const sendKeys = h.calls.find(c => c[0] === "send-keys" && String(c[3]).includes("--append-system-prompt-file"))!;
    expect(sendKeys).toBeTruthy();
    const file = join(h.sysPromptDir, `${term.id}.md`);
    expect(String(sendKeys[3])).toContain(`'${file}'`);
    expect(readFileSync(file, "utf8")).toBe("GLOBAL.\n\nWORKSPACE.\n\nTERMINAL.");
  });

  it("writes Codex's prompt into AGENTS.md in the folder and does NOT add a flag", async () => {
    const folder = mkdtempSync(join(tmpdir(), "tr-codex-"));
    try {
      h.ctx.store.setAgentSystemPrompts({ codex: "Be careful, Codex." });
      const ws = h.ctx.store.createWorkspace({ name: "A", folder, launchCommand: "codex", color: null });
      const res = await h.app.inject({
        method: "POST", url: `/api/workspaces/${ws.id}/terminals`,
        payload: { agentId: "codex", launchCommandOverride: "codex" },
      });
      expect(res.statusCode).toBe(200);
      expect(readFileSync(join(folder, "AGENTS.md"), "utf8")).toContain("Be careful, Codex.");
      // launch command is just `codex` — no flag for a file-based agent
      const sendKeys = h.calls.find(c => c[0] === "send-keys")!;
      expect(sendKeys[3]).toBe("codex");
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  it("no agentId → no prompt file, launch unchanged", async () => {
    h.ctx.store.setAgentSystemPrompts({ claude: "GLOBAL." });
    const ws = h.ctx.store.createWorkspace({ name: "A", folder: "/work", launchCommand: "claude", color: null });
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} });
    const term = res.json().terminal;
    expect(existsSync(join(h.sysPromptDir, `${term.id}.md`))).toBe(false);
    const sendKeys = h.calls.find(c => c[0] === "send-keys")!;
    expect(sendKeys[3]).toBe("claude");
  });
});

describe("terminal resolve-path route", () => {
  let h: ReturnType<typeof build>;
  let folder: string;
  beforeEach(() => {
    h = build();
    folder = mkdtempSync(join(tmpdir(), "tr-resolve-"));
    writeFileSync(join(folder, "a.txt"), "hi");
    mkdirSync(join(folder, "sub"));
  });
  afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

  async function makeTerminal() {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder, launchCommand: "", color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    return { ws, term };
  }
  const resolve = (wsId: string, tid: string, text: string) =>
    h.app.inject({ method: "GET", url: `/api/workspaces/${wsId}/terminals/${tid}/resolve-path?text=${encodeURIComponent(text)}` });

  it("classifies an absolute path as file, dir, or missing", async () => {
    const { ws, term } = await makeTerminal();
    expect((await resolve(ws.id, term.id, join(folder, "a.txt"))).json()).toEqual({ path: join(folder, "a.txt"), type: "file" });
    expect((await resolve(ws.id, term.id, join(folder, "sub"))).json()).toEqual({ path: join(folder, "sub"), type: "dir" });
    expect((await resolve(ws.id, term.id, join(folder, "nope"))).json()).toEqual({ path: join(folder, "nope"), type: "missing" });
  });

  it("resolves a relative path against the pane's live cwd (honours cd), not just the workspace folder", async () => {
    const { ws, term } = await makeTerminal();
    const other = mkdtempSync(join(tmpdir(), "tr-cwd-"));
    writeFileSync(join(other, "b.txt"), "yo");
    h.setPaneCwd(other);
    try {
      expect((await resolve(ws.id, term.id, "b.txt")).json()).toEqual({ path: join(other, "b.txt"), type: "file" });
    } finally { rmSync(other, { recursive: true, force: true }); }
  });

  it("falls back to the workspace folder when tmux reports no cwd", async () => {
    const { ws, term } = await makeTerminal();
    h.setPaneCwd(""); // session gone / no path
    expect((await resolve(ws.id, term.id, "a.txt")).json()).toEqual({ path: join(folder, "a.txt"), type: "file" });
  });

  it("404s for an unknown terminal", async () => {
    const { ws } = await makeTerminal();
    expect((await resolve(ws.id, "tm_nope", "a.txt")).statusCode).toBe(404);
  });
});

describe("terminal clip-image route", () => {
  let h: ReturnType<typeof build>;
  let folder: string;
  beforeEach(() => { h = build(); folder = mkdtempSync(join(tmpdir(), "tr-route-")); });
  afterEach(() => { rmSync(folder, { recursive: true, force: true }); });

  async function makeTerminal(launchCommand: string) {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder, launchCommand, color: null });
    const term = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals`, payload: {} })).json().terminal;
    return { ws, term };
  }
  const png = (s: string) => ({ imageBase64: Buffer.from(s).toString("base64"), mimeType: "image/png" });

  it("writes the pasted image to disk and returns its absolute path to insert", async () => {
    const { ws, term } = await makeTerminal("claude");
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals/${term.id}/clip-image`, payload: png("hello") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe(`.terminalhub/clip/${term.id}/${body.path.split("/").pop()}`);
    expect(body.path).toMatch(/img-[a-z0-9]+\.png$/);
    expect(body.insert).toBe(join(folder, body.path)); // absolute path so it resolves regardless of cwd
    expect(readFileSync(join(folder, body.path), "utf8")).toBe("hello");
  });

  it("inserts the same absolute path for any agent — no @ prefix for Claude", async () => {
    const { ws, term } = await makeTerminal("codex");
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals/${term.id}/clip-image`, payload: png("x") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.insert).toBe(join(folder, body.path));
    expect(body.insert.startsWith("@")).toBe(false);
  });

  it("404s when the terminal does not exist", async () => {
    const ws = h.ctx.store.createWorkspace({ name: "A", folder, launchCommand: "claude", color: null });
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals/tm_nope/clip-image`, payload: png("x") });
    expect(res.statusCode).toBe(404);
  });

  it("404s when the terminal belongs to a different workspace", async () => {
    const { term } = await makeTerminal("claude");
    const other = h.ctx.store.createWorkspace({ name: "B", folder, launchCommand: "claude", color: null });
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${other.id}/terminals/${term.id}/clip-image`, payload: png("x") });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a non-image mime type", async () => {
    const { ws, term } = await makeTerminal("claude");
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals/${term.id}/clip-image`,
      payload: { imageBase64: Buffer.from("x").toString("base64"), mimeType: "text/plain" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an image over the size cap", async () => {
    const { ws, term } = await makeTerminal("claude");
    const big = Buffer.alloc(11 * 1024 * 1024, 1).toString("base64"); // 11 MB decoded > 10 MB cap
    const res = await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals/${term.id}/clip-image`,
      payload: { imageBase64: big, mimeType: "image/png" } });
    expect(res.statusCode).toBe(413);
  });

  it("clears a terminal's pasted images when the terminal is deleted", async () => {
    const { ws, term } = await makeTerminal("claude");
    const body = (await h.app.inject({ method: "POST", url: `/api/workspaces/${ws.id}/terminals/${term.id}/clip-image`, payload: png("x") })).json();
    expect(existsSync(join(folder, body.path))).toBe(true);
    await h.app.inject({ method: "DELETE", url: `/api/terminals/${term.id}` });
    expect(existsSync(join(folder, ".terminalhub", "clip", term.id))).toBe(false);
  });
});
