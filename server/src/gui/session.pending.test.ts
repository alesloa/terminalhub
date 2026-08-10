import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";

// A request that blocks the agent (a question, an approval) is emitted once, live. Whoever answers
// it may not be the client that saw it — switching terminal tabs unmounts the panel and drops the
// socket, and the agent keeps waiting. So the session has to be able to hand its outstanding
// requests to a client that shows up afterwards; without that the chat sits on "waiting" with
// nothing on screen to answer and the turn can never finish.

let captured: Options | null = null;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ options }: { options: Options }) => {
    captured = options;
    return {
      async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
      return: async () => ({ done: true, value: undefined }),
      supportedModels: async () => [],
      interrupt: async () => {},
    };
  },
}));

const { createGuiSession } = await import("./session.js");
const { DEFAULT_GUI_CONFIG } = await import("./config.js");

function start() {
  const session = createGuiSession({
    terminalId: "tm_pending",
    cwd: "/tmp",
    config: DEFAULT_GUI_CONFIG,
  });
  const canUseTool = captured?.canUseTool;
  if (!canUseTool) throw new Error("session did not start a query");
  return { session, canUseTool, signal: new AbortController().signal };
}

const ASK = {
  questions: [{
    question: "Should the checkbox stay pre-checked?",
    header: "Default",
    multiSelect: false,
    options: [{ label: "Yes", description: "keep it" }, { label: "No", description: "clear it" }],
  }],
};

describe("gui session — outstanding requests", () => {
  beforeEach(() => { captured = null; });

  it("has nothing pending before anything asks", () => {
    const { session } = start();
    expect(session.pending()).toEqual([]);
  });

  it("reports an unanswered question so a late client can be shown it", () => {
    const { session, canUseTool, signal } = start();
    void canUseTool("AskUserQuestion", ASK, { signal, suggestions: [] });

    expect(session.pending()).toEqual([{
      type: "question.request",
      request: {
        id: expect.any(String),
        questions: [{
          id: "Should the checkbox stay pre-checked?",
          question: "Should the checkbox stay pre-checked?",
          header: "Default",
          multiSelect: false,
          options: [{ label: "Yes", description: "keep it" }, { label: "No", description: "clear it" }],
        }],
      },
    }]);
    expect(session.state()).toBe("waiting");
  });

  it("reports an unanswered tool approval the same way", () => {
    const { session, canUseTool, signal } = start();
    void canUseTool("Bash", { command: "ls" }, { signal, suggestions: [] });

    expect(session.pending()).toEqual([{
      type: "approval.request",
      request: { id: expect.any(String), toolName: "Bash", input: { command: "ls" }, canAllowForSession: false },
    }]);
  });

  it("drops a question from pending once it is answered", () => {
    const { session, canUseTool, signal } = start();
    void canUseTool("AskUserQuestion", ASK, { signal, suggestions: [] });

    const [event] = session.pending();
    if (event?.type !== "question.request") throw new Error("expected a pending question");
    session.resolveQuestion(event.request.id, { "Should the checkbox stay pre-checked?": ["Yes"] });

    expect(session.pending()).toEqual([]);
  });

  it("drops an approval from pending once it is decided", () => {
    const { session, canUseTool, signal } = start();
    void canUseTool("Bash", { command: "ls" }, { signal, suggestions: [] });

    const [event] = session.pending();
    if (event?.type !== "approval.request") throw new Error("expected a pending approval");
    session.resolveApproval(event.request.id, "deny");

    expect(session.pending()).toEqual([]);
  });

  it("replays a question to a subscriber that connects after it was asked", () => {
    const { session, canUseTool, signal } = start();
    void canUseTool("AskUserQuestion", ASK, { signal, suggestions: [] });

    // A brand-new socket: it missed the live emit entirely.
    const seen: string[] = [];
    session.subscribe((e) => seen.push(e.type));
    expect(seen).toEqual([]);
    for (const e of session.pending()) seen.push(e.type);
    expect(seen).toEqual(["question.request"]);
  });
});
