import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CodexAppServer, ServerRequestHandler } from "../../codex/appServer.js";
import { CODEX_METHOD, CODEX_NOTIFICATION, CODEX_SERVER_REQUEST } from "../../codex/protocol.js";
import type { GuiEvent } from "../types.js";

// The Codex session driven against a fake app-server: every assertion here is about what the session
// SENDS to Codex and what it EMITS to the chat, which is the whole of its job. The transport itself
// is covered in ../../codex/appServer.test.ts, and the notification→event mapping in ./normalize.test.ts.

interface Call { method: string; params: unknown }

/** The fake `codex app-server` the session under test talks to. One per session. */
class FakeServer {
  readonly calls: Call[] = [];
  readonly requestHandlers = new Map<string, ServerRequestHandler>();
  private readonly notificationSubscribers = new Set<(m: string, p: unknown) => void>();
  private settleExit!: (code: number | null) => void;
  readonly exited = new Promise<number | null>((r) => { this.settleExit = r; });
  closed = false;
  /** Method → what `request` should answer with (or throw, if it's an Error). */
  answers: Record<string, unknown> = {};

  readonly api: CodexAppServer = {
    request: async <T>(method: string, params?: unknown): Promise<T> => {
      this.calls.push({ method, params });
      const answer = this.answers[method];
      if (answer instanceof Error) throw answer;
      if (answer !== undefined) return answer as T;
      if (method === CODEX_METHOD.threadStart || method === CODEX_METHOD.threadResume) {
        return { thread: { id: "th_1", cwd: "/w", turns: [] }, model: "gpt-5.6-sol" } as T;
      }
      return {} as T;
    },
    notify: (method: string, params?: unknown) => { this.calls.push({ method, params }); },
    onRequest: (method, handler) => { this.requestHandlers.set(method, handler); },
    onNotification: (fn) => { this.notificationSubscribers.add(fn); },
    exited: this.exited,
    alive: () => !this.closed,
    close: async () => { this.closed = true; this.settleExit(0); },
  };

  /** Push a notification as the real server would. */
  emit(method: string, params: unknown): void {
    for (const fn of this.notificationSubscribers) fn(method, params);
  }

  /** Ask the session something, the way the server asks for an approval. */
  ask(method: string, params: unknown): Promise<unknown> {
    const handler = this.requestHandlers.get(method);
    if (!handler) throw new Error(`no handler for ${method}`);
    return handler(params);
  }

  sent(method: string): Call[] { return this.calls.filter((c) => c.method === method); }
}

/** Every server the module under test spawned, newest last — a restart makes a second one. */
let servers: FakeServer[] = [];

vi.mock("../../codex/appServer.js", () => ({
  startCodexAppServer: () => {
    const server = new FakeServer();
    servers.push(server);
    return server.api;
  },
}));

// Real git snapshots would shell out per turn; the checkpointer has its own tests.
const checkpointCalls: string[] = [];
vi.mock("../checkpointer.js", () => ({
  createGuiCheckpointer: () => ({
    beforeTurn: async (text: string) => { checkpointCalls.push(`beforeTurn:${text}`); },
    preview: async () => ({ ok: false as const, reason: "no snapshot" }),
    restore: async () => ({ ok: true as const, stat: { files: 2, insertions: 3, deletions: 1, removed: 0 } }),
    cutTo: async (turnIndex: number) => { checkpointCalls.push(`cutTo:${turnIndex}`); },
  }),
}));

const { createCodexGuiSession } = await import("./session.js");
const { DEFAULT_GUI_CONFIG } = await import("../config.js");

function start(over: Parameters<typeof createCodexGuiSession>[0] | object = {}) {
  const events: GuiEvent[] = [];
  const sessionIds: string[] = [];
  const attention: number[] = [];
  const session = createCodexGuiSession({
    terminalId: "tm_codex",
    cwd: "/w",
    config: { ...DEFAULT_GUI_CONFIG },
    onSessionId: (id) => sessionIds.push(id),
    onAttention: () => attention.push(1),
    ...over,
  });
  session.subscribe((e) => events.push(e));
  return { session, events, sessionIds, attention, server: () => servers[servers.length - 1] };
}

/** Let the session's own promise chain (ready → snapshot → send) run to completion. */
const settle = () => new Promise<void>((r) => { setTimeout(r, 0); });

beforeEach(() => { servers = []; checkpointCalls.length = 0; });

describe("codex session — startup", () => {
  it("handshakes and opens a thread in the workspace folder", async () => {
    const { session, server } = start();
    await session.history();

    const methods = server().calls.map((c) => c.method);
    expect(methods.slice(0, 3)).toEqual([
      CODEX_METHOD.initialize, CODEX_METHOD.initialized, CODEX_METHOD.threadStart,
    ]);
    expect(server().sent(CODEX_METHOD.threadStart)[0].params).toMatchObject({
      cwd: "/w", approvalPolicy: "untrusted", sandbox: "read-only",
    });
    await session.stop();
  });

  it("publishes the thread id as the chat's session id", async () => {
    const { session, sessionIds } = start();
    await session.history();
    expect(sessionIds).toEqual(["th_1"]);
    expect(session.sessionId()).toBe("th_1");
    await session.stop();
  });

  it("resumes a stored thread and seeds its turns as history", async () => {
    const { session } = start({ resumeSessionId: "th_old" });
    servers[0].answers[CODEX_METHOD.threadResume] = {
      thread: {
        id: "th_old", cwd: "/w",
        turns: [{
          id: "t1", status: "completed",
          items: [
            { type: "userMessage", id: "u1", content: [{ type: "text", text: "hello" }] },
            { type: "agentMessage", id: "a1", text: "hi" },
          ],
        }],
      },
      model: "gpt-5.6-sol",
    };

    const history = await session.history();
    expect(servers[0].sent(CODEX_METHOD.threadResume)[0].params).toMatchObject({ threadId: "th_old" });
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(servers[0].sent(CODEX_METHOD.threadStart)).toHaveLength(0);
    await session.stop();
  });

  it("starts a fresh thread when the stored one is gone", async () => {
    const { session } = start({ resumeSessionId: "th_stale" });
    servers[0].answers[CODEX_METHOD.threadResume] = new Error("no such thread");

    await session.history();
    // A chat that can never send anything is worse than a chat that lost its history.
    expect(servers[0].sent(CODEX_METHOD.threadStart)).toHaveLength(1);
    expect(session.sessionId()).toBe("th_1");
    await session.stop();
  });

  it("goes to error, not silence, when the thread cannot be opened at all", async () => {
    const { session, events } = start();
    servers[0].answers[CODEX_METHOD.threadStart] = new Error("codex is not logged in");

    await session.history();
    expect(session.state()).toBe("error");
    expect(events.filter((e) => e.type === "error")).toMatchObject([{ message: "codex is not logged in" }]);
    await session.stop();
  });
});

describe("codex session — sending", () => {
  it("echoes the user's turn immediately, then starts a turn once the snapshot is taken", async () => {
    const { session, events, server } = start();
    await session.history();

    session.prompt("do the thing");
    // The bubble is on screen before anything has been sent.
    expect(events.filter((e) => e.type === "message.start")).toMatchObject([{ role: "user" }]);
    expect(server().sent(CODEX_METHOD.turnStart)).toHaveLength(0);

    await settle();
    expect(checkpointCalls).toContain("beforeTurn:do the thing");
    expect(server().sent(CODEX_METHOD.turnStart)[0].params).toMatchObject({
      threadId: "th_1", input: [{ type: "text", text: "do the thing" }], approvalPolicy: "untrusted",
    });
    await session.stop();
  });

  it("steers the running turn instead of queueing a second one", async () => {
    const { session, server } = start();
    await session.history();
    server().emit(CODEX_NOTIFICATION.turnStarted, { threadId: "th_1", turn: { id: "turn_1", items: [], status: "inProgress" } });

    session.prompt("also do this");
    await settle();

    expect(server().sent(CODEX_METHOD.turnStart)).toHaveLength(0);
    expect(server().sent(CODEX_METHOD.turnSteer)[0].params).toMatchObject({
      threadId: "th_1", expectedTurnId: "turn_1", input: [{ type: "text", text: "also do this" }],
    });
    await session.stop();
  });

  it("sends an attached image as the data URI the browser gave us", async () => {
    const { session, server } = start();
    await session.history();

    session.prompt("what is this", [{ mediaType: "image/png", dataBase64: "AAAA" }]);
    await settle();

    expect(server().sent(CODEX_METHOD.turnStart)[0].params).toMatchObject({
      input: [{ type: "image", url: "data:image/png;base64,AAAA" }, { type: "text", text: "what is this" }],
    });
    await session.stop();
  });

  it("carries the composer's model and effort onto the turn", async () => {
    const { session, server } = start({
      config: { ...DEFAULT_GUI_CONFIG, model: "gpt-5.6-terra", effort: "xhigh" },
    });
    await session.history();

    session.prompt("go");
    await settle();
    expect(server().sent(CODEX_METHOD.turnStart)[0].params).toMatchObject({ model: "gpt-5.6-terra", effort: "xhigh" });
    await session.stop();
  });

  it("sends no effort for a Claude-only level rather than guessing one", async () => {
    const { session, server } = start({ config: { ...DEFAULT_GUI_CONFIG, effort: "ultrathink" } });
    await session.history();

    session.prompt("go");
    await settle();
    expect(server().sent(CODEX_METHOD.turnStart)[0].params).not.toHaveProperty("effort");
    await session.stop();
  });

  it("ignores an empty prompt", async () => {
    const { session, events, server } = start();
    await session.history();
    session.prompt("   ");
    await settle();
    expect(events.some((e) => e.type === "message.start")).toBe(false);
    expect(server().sent(CODEX_METHOD.turnStart)).toHaveLength(0);
    await session.stop();
  });

  it("surfaces a refused turn instead of leaving the composer locked", async () => {
    const { session, events, server } = start();
    await session.history();
    server().answers[CODEX_METHOD.turnStart] = new Error("model unavailable");

    session.prompt("go");
    await settle();
    expect(session.state()).toBe("idle");
    expect(events.filter((e) => e.type === "error")).toMatchObject([{ message: "model unavailable" }]);
    await session.stop();
  });
});

describe("codex session — approvals and questions", () => {
  it("asks the chat about a command and answers codex with the decision", async () => {
    const { session, events, server, attention } = start();
    await session.history();

    const answer = server().ask(CODEX_SERVER_REQUEST.commandApproval, {
      itemId: "i1", threadId: "th_1", turnId: "turn_1", command: "rm -rf build", cwd: "/w",
    });
    const request = events.find((e) => e.type === "approval.request") as { request: { id: string; toolName: string; input: unknown } };
    expect(request.request).toMatchObject({ toolName: "Bash", input: { command: "rm -rf build", cwd: "/w" }, canAllowForSession: true });
    expect(session.state()).toBe("waiting");
    expect(attention).toHaveLength(1);

    session.resolveApproval(request.request.id, "allowForSession");
    expect(await answer).toEqual({ decision: "acceptForSession" });
    await session.stop();
  });

  it("declines on a deny", async () => {
    const { session, events, server } = start();
    await session.history();

    const answer = server().ask(CODEX_SERVER_REQUEST.fileChangeApproval, {
      itemId: "i2", threadId: "th_1", turnId: "turn_1", reason: "outside the workspace",
    });
    const request = events.find((e) => e.type === "approval.request") as { request: { id: string; toolName: string } };
    expect(request.request.toolName).toBe("ApplyPatch");

    session.resolveApproval(request.request.id, "deny");
    expect(await answer).toEqual({ decision: "decline" });
    await session.stop();
  });

  it("shapes an answered question the way codex expects it back", async () => {
    const { session, events, server } = start();
    await session.history();

    const answer = server().ask(CODEX_SERVER_REQUEST.requestUserInput, {
      itemId: "i3", threadId: "th_1", turnId: "turn_1", isBlocking: true,
      questions: [{ id: "q1", header: "Scope", question: "Which folder?", options: [{ label: "web", description: "" }] }],
    });
    const request = events.find((e) => e.type === "question.request") as { request: { id: string; questions: { id: string }[] } };
    expect(request.request.questions[0]).toMatchObject({ id: "q1", question: "Which folder?", multiSelect: false });

    session.resolveQuestion(request.request.id, { q1: ["web"] });
    expect(await answer).toEqual({ answers: { q1: { answers: ["web"] } } });
    await session.stop();
  });

  it("answers a question with no questions in it without bothering the user", async () => {
    const { session, events, server } = start();
    await session.history();
    expect(await server().ask(CODEX_SERVER_REQUEST.requestUserInput, { questions: [] })).toEqual({ answers: {} });
    expect(events.some((e) => e.type === "question.request")).toBe(false);
    await session.stop();
  });
});

describe("codex session — stopping", () => {
  it("interrupts the running turn and closes it out", async () => {
    const { session, events, server } = start();
    await session.history();
    server().emit(CODEX_NOTIFICATION.turnStarted, { threadId: "th_1", turn: { id: "turn_1", items: [], status: "inProgress" } });

    await session.interrupt();

    expect(server().sent(CODEX_METHOD.turnInterrupt)[0].params).toMatchObject({ threadId: "th_1", turnId: "turn_1" });
    expect(events.filter((e) => e.type === "turn.end")).toMatchObject([{ turnId: "turn_1", status: "interrupted" }]);
    expect(session.state()).toBe("idle");
    await session.stop();
  });

  it("denies an approval that was holding the turn open", async () => {
    const { session, events, server } = start();
    await session.history();
    const answer = server().ask(CODEX_SERVER_REQUEST.commandApproval, { command: "sleep 999" });
    await settle();

    await session.interrupt();
    expect(await answer).toEqual({ decision: "decline" });
    expect(events.filter((e) => e.type === "approval.resolved")).toMatchObject([{ decision: "deny" }]);
    await session.stop();
  });

  it("cancels a prompt that was still waiting on its workspace snapshot", async () => {
    const { session, server } = start();
    await session.history();

    session.prompt("too late");
    await session.interrupt();
    await settle();

    // The stop landed before the turn was ever handed over, so nothing runs.
    expect(server().sent(CODEX_METHOD.turnStart)).toHaveLength(0);
    await session.stop();
  });

  it("closes the app-server on stop and refuses to run afterwards", async () => {
    const { session, server } = start();
    await session.history();
    const app = server();
    await session.stop();
    expect(app.closed).toBe(true);
    expect(session.state()).toBe("stopped");
  });
});

describe("codex session — config", () => {
  it("applies a model change without reopening the thread", async () => {
    const { session, events } = start();
    await session.history();

    await session.setConfig({ ...DEFAULT_GUI_CONFIG, model: "gpt-5.6-terra" });
    expect(servers).toHaveLength(1);
    expect(events.filter((e) => e.type === "config")).toHaveLength(1);
    await session.stop();
  });

  it("reopens the thread when the sandbox has to change, carrying it over by id", async () => {
    const { session } = start();
    await session.history();

    await session.setConfig({ ...DEFAULT_GUI_CONFIG, permissionMode: "full-access" });

    expect(servers).toHaveLength(2);
    expect(servers[0].closed).toBe(true);
    expect(servers[1].sent(CODEX_METHOD.threadResume)[0].params).toMatchObject({
      threadId: "th_1", sandbox: "danger-full-access", approvalPolicy: "never",
    });
    await session.stop();
  });

  it("does nothing at all when the config is unchanged", async () => {
    const { session, events } = start();
    await session.history();
    await session.setConfig({ ...DEFAULT_GUI_CONFIG });
    expect(events.some((e) => e.type === "config")).toBe(false);
    await session.stop();
  });
});

describe("codex session — rewind", () => {
  /** A session holding two exchanges, ready to be cut back. */
  async function twoTurns() {
    const h = start({ resumeSessionId: "th_old" });
    h.server().answers[CODEX_METHOD.threadResume] = {
      thread: {
        id: "th_old", cwd: "/w",
        turns: [
          { id: "t1", status: "completed", items: [
            { type: "userMessage", id: "u1", content: [{ type: "text", text: "first" }] },
            { type: "agentMessage", id: "a1", text: "one" },
          ] },
          { id: "t2", status: "completed", items: [
            { type: "userMessage", id: "u2", content: [{ type: "text", text: "second" }] },
            { type: "agentMessage", id: "a2", text: "two" },
          ] },
        ],
      },
      model: "gpt-5.6-sol",
    };
    await h.session.history();
    return h;
  }

  it("drops the target turn and everything after it", async () => {
    const { session, events, server } = await twoTurns();

    expect(await session.rewind({ userTurnsAfter: 0, text: "second" })).toEqual({ ok: true });
    expect(server().sent(CODEX_METHOD.threadRollback)[0].params).toEqual({ threadId: "th_old", numTurns: 1 });

    const reset = events.find((e) => e.type === "history.reset") as { messages: { blocks: { text?: string }[] }[] };
    expect(reset.messages).toHaveLength(2); // "first" and its answer survive
    expect(await session.history()).toHaveLength(2);
    await session.stop();
  });

  it("counts back through the turns that follow the target", async () => {
    const { session, server } = await twoTurns();
    await session.rewind({ userTurnsAfter: 1, text: "first" });
    expect(server().sent(CODEX_METHOD.threadRollback)[0].params).toEqual({ threadId: "th_old", numTurns: 2 });
    expect(await session.history()).toEqual([]);
    await session.stop();
  });

  it("refuses a target the conversation no longer has", async () => {
    const { session, server } = await twoTurns();
    expect(await session.rewind({ userTurnsAfter: 9, text: "gone" }))
      .toEqual({ ok: false, error: "That message is no longer in this conversation." });
    expect(server().sent(CODEX_METHOD.threadRollback)).toHaveLength(0);
    await session.stop();
  });

  it("keeps the conversation intact when codex refuses the rollback", async () => {
    const { session, events, server } = await twoTurns();
    server().answers[CODEX_METHOD.threadRollback] = new Error("thread is locked");

    expect(await session.rewind({ userTurnsAfter: 0, text: "second" }))
      .toEqual({ ok: false, error: "thread is locked" });
    expect(events.some((e) => e.type === "history.reset")).toBe(false);
    expect(await session.history()).toHaveLength(4);
    await session.stop();
  });

  it("re-sends the turn when the message was edited rather than deleted", async () => {
    const { session, server } = await twoTurns();
    await session.rewind({ userTurnsAfter: 0, text: "second", newText: "second, but better" });
    await settle();

    expect(server().sent(CODEX_METHOD.turnStart)[0].params).toMatchObject({
      input: [{ type: "text", text: "second, but better" }],
    });
    await session.stop();
  });

  it("only touches the working tree when the undo was actually asked for", async () => {
    const { session, events } = await twoTurns();
    await session.rewind({ userTurnsAfter: 0, text: "second" });
    expect(events.some((e) => e.type === "notice")).toBe(false);

    const second = await twoTurns();
    await second.session.rewind({ userTurnsAfter: 0, text: "second", restoreFiles: true });
    // Codex's own rollback leaves files alone — the git checkpoint is the half that reverts them.
    expect(second.events.find((e) => e.type === "notice")).toMatchObject({ message: expect.stringContaining("Reverted 2 files") });
    await session.stop();
    await second.session.stop();
  });

  it("refuses to rewind while a turn is running", async () => {
    const { session, server } = await twoTurns();
    server().emit(CODEX_NOTIFICATION.turnStarted, { threadId: "th_old", turn: { id: "turn_9", items: [], status: "inProgress" } });

    expect(await session.rewind({ userTurnsAfter: 0, text: "second" }))
      .toEqual({ ok: false, error: "Codex is working — stop it first." });
    await session.stop();
  });
});

describe("codex session — reporting", () => {
  it("reads the context meter off codex's own token accounting", async () => {
    const { session, server } = start();
    await session.history();
    server().emit(CODEX_NOTIFICATION.tokenUsage, {
      threadId: "th_1", turnId: "turn_1",
      tokenUsage: { total: { totalTokens: 40_000, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0 }, modelContextWindow: 400_000 },
    });
    expect(await session.contextUsage()).toEqual({
      usedTokens: 40_000, maxTokens: 400_000, percentage: 10, autoCompact: true,
    });
    await session.stop();
  });

  it("builds the model picker from what the installed codex advertises", async () => {
    const { session, server } = start();
    await session.history();
    server().answers[CODEX_METHOD.modelList] = {
      data: [
        { id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "Sol", description: "d", isDefault: true, hidden: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }] },
        { id: "legacy", model: "legacy", displayName: "Legacy", description: "d", isDefault: false, hidden: true, defaultReasoningEffort: "low", supportedReasoningEfforts: [] },
      ],
    };
    expect((await session.models()).map((m) => m.value)).toEqual(["gpt-5.6-sol"]);
    await session.stop();
  });

  it("reports a retryable hiccup as a notice, not as a failure", async () => {
    const { session, events, server } = start();
    await session.history();
    server().emit(CODEX_NOTIFICATION.error, { threadId: "th_1", turnId: "t", willRetry: true, error: { message: "rate limited" } });
    expect(events.filter((e) => e.type === "notice")).toMatchObject([{ message: "rate limited" }]);
    expect(events.some((e) => e.type === "error")).toBe(false);
    await session.stop();
  });

  it("rings once for a finished turn, never for one the user stopped", async () => {
    const { session, server, attention } = start();
    await session.history();
    server().emit(CODEX_NOTIFICATION.turnCompleted, { threadId: "th_1", turn: { id: "t1", items: [], status: "completed" } });
    expect(attention).toHaveLength(1);
    server().emit(CODEX_NOTIFICATION.turnCompleted, { threadId: "th_1", turn: { id: "t2", items: [], status: "interrupted" } });
    expect(attention).toHaveLength(1);
    await session.stop();
  });

  it("tells the chat when codex dies under it", async () => {
    const { session, events, server } = start();
    await session.history();
    await server().api.close();
    await settle();

    expect(session.state()).toBe("error");
    expect(events.filter((e) => e.type === "error")).toMatchObject([{ message: expect.stringContaining("stopped unexpectedly") }]);
    await session.stop();
  });
});
