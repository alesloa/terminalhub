import { describe, expect, it, vi } from "vitest";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// The one ordering that actually matters for "undo file changes": the workspace snapshot has to be
// on disk BEFORE the agent is handed the turn. A baseline taken a moment late already contains the
// turn's own edits, so undoing to it would leave exactly the changes the user asked to remove.

const hooks = vi.hoisted(() => {
  const order: string[] = [];
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return { order, gate, release: () => release?.() };
});

vi.mock("../git/checkpoints.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git/checkpoints.js")>();
  return {
    ...actual,
    createGitCheckpoints: () => ({
      isRepo: async () => true,
      capture: async () => { await hooks.gate; hooks.order.push("snapshot"); return true; },
      relabel: async () => true,
      label: async () => null,
      preview: async () => null,
      restore: async () => null,
      turns: async () => [],
      remove: async () => {},
    }),
  };
});

let prompt: AsyncIterable<SDKUserMessage> | null = null;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    prompt = args.prompt;
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

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("gui session — workspace snapshots", () => {
  it("does not hand the turn to the agent until the snapshot is taken", async () => {
    const session = createGuiSession({
      terminalId: "tm_checkpoint", cwd: "/tmp", config: DEFAULT_GUI_CONFIG,
    });
    await tick();
    if (!prompt) throw new Error("session did not start a query");

    const reader = prompt[Symbol.asyncIterator]();
    const first = reader.next().then((r) => { hooks.order.push("prompt"); return r; });

    session.prompt("change some files");
    await tick();
    // The echo is already in the transcript — the composer never waits on git.
    expect(session.messages().at(-1)?.role).toBe("user");
    expect(hooks.order).toEqual([]);

    hooks.release();
    const delivered = await first;
    expect(hooks.order).toEqual(["snapshot", "prompt"]);
    expect(delivered.done).toBe(false);

    await session.stop();
  });
});
