import { describe, expect, it, vi } from "vitest";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GuiMessage } from "./types.js";

// What a browser gets when it reconnects mid-conversation — a refresh, a tab switch, a second
// window. Both halves of that used to be wrong: the conversation shrank to whatever THIS session
// process had streamed, and the reconnecting client was told the agent was idle while it was still
// working (no stop button, no working indicator, text arriving into a chat that looked finished).

const disk: GuiMessage[] = [
  { id: "h1", role: "user", blocks: [{ kind: "text", id: "h1_0", text: "older turn" }], ts: 1 },
  { id: "h2", role: "assistant", blocks: [{ kind: "text", id: "h2_0", text: "older reply" }], ts: 2 },
];

vi.mock("./history.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./history.js")>();
  return { ...actual, loadHistory: async () => disk.map((m) => ({ ...m })) };
});

vi.mock("../git/checkpoints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git/checkpoints.js")>();
  return {
    ...actual,
    createGitCheckpoints: () => ({
      isRepo: async () => false,
      capture: async () => false,
      relabel: async () => false,
      label: async () => null,
      preview: async () => null,
      restore: async () => null,
      turns: async () => [],
      remove: async () => {},
    }),
  };
});

// A stream the test drives by hand: the session sees exactly the SDK frames pushed into it.
const stream = vi.hoisted(() => {
  const items: unknown[] = [];
  let wake: (() => void) | null = null;
  return {
    push(message: unknown) { items.push(message); wake?.(); wake = null; },
    async *iterate() {
      for (;;) {
        const next = items.shift();
        if (next) { yield next; continue; }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    },
  };
});

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (_args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => ({
    [Symbol.asyncIterator]: () => stream.iterate(),
    return: async () => ({ done: true, value: undefined }),
    supportedModels: async () => [],
    interrupt: async () => {},
  }),
}));

const { createGuiSession } = await import("./session.js");
const { DEFAULT_GUI_CONFIG } = await import("./config.js");

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** One assistant frame, the shape the normalizer folds into a text block. */
const assistantSays = (text: string) => ({
  type: "assistant",
  uuid: `u_${text}`,
  message: { id: `m_${text}`, role: "assistant", content: [{ type: "text", text }] },
});

describe("gui session — what a reconnecting client is replayed", () => {
  it("answers with the whole conversation, not just what this session streamed", async () => {
    const session = createGuiSession({
      terminalId: "tm_reconnect", cwd: "/tmp", config: DEFAULT_GUI_CONFIG,
      resumeSessionId: "11111111-2222-3333-4444-555555555555",
    });
    await tick();

    session.prompt("a new turn");
    await tick();

    const history = await session.history();
    expect(history.map((m) => m.blocks[0]?.kind === "text" && m.blocks[0].text)).toEqual([
      "older turn", "older reply", "a new turn",
    ]);

    await session.stop();
  });

  it("starts fresh with no prefix when the conversation is new", async () => {
    const session = createGuiSession({ terminalId: "tm_fresh", cwd: "/tmp", config: DEFAULT_GUI_CONFIG });
    await tick();
    expect(await session.history()).toEqual([]);
    await session.stop();
  });

  it("opens a turn from the agent's own output, not just from a prompt this socket sent", async () => {
    const session = createGuiSession({ terminalId: "tm_stream", cwd: "/tmp", config: DEFAULT_GUI_CONFIG });
    await tick();

    const seen: string[] = [];
    session.subscribe((event) => seen.push(event.type));

    // Nobody prompted through THIS session object — the equivalent of a browser that refreshed while
    // the agent was working, or a hub that reattached to a run already in flight.
    stream.push(assistantSays("still working"));
    await tick();

    expect(seen).toContain("turn.start");
    expect(session.state()).toBe("running");
    // …and a client connecting right now is told about it, or its composer sits idle mid-turn.
    expect(session.pending().map((e) => e.type)).toContain("turn.start");

    await session.stop();
  });

  it("does not open a second turn while one is already open", async () => {
    const session = createGuiSession({ terminalId: "tm_single", cwd: "/tmp", config: DEFAULT_GUI_CONFIG });
    await tick();

    const starts: string[] = [];
    session.subscribe((event) => { if (event.type === "turn.start") starts.push(event.turnId); });

    session.prompt("go");
    await tick();
    stream.push(assistantSays("one"));
    await tick();
    stream.push(assistantSays("two"));
    await tick();

    expect(starts).toHaveLength(1);
    expect(session.pending().filter((e) => e.type === "turn.start")).toHaveLength(1);

    await session.stop();
  });
});
