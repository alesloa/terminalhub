import { describe, it, expect } from "vitest";
import { runCopilotTurn, type CopilotEvent } from "./agent.js";
import { createRegistry } from "./registry.js";
import type { AssistantTurn, ChatStreamRequest, CopilotProvider, CopilotCtx, ContentBlock, ProviderToolCall, ToolDef } from "./types.js";

const settings = { enabled: true, defaultEngine: null, reportChannels: ["toast"], confirmDangerous: true, orbEnabled: true, orbPosition: "bottom-right" } as const;
const userCtx = (): CopilotCtx => ({ app: {} as any, settings: { ...settings }, actor: "user" });

const toolTurn = (id: string, name: string, input: unknown, text = ""): AssistantTurn => ({
  text,
  toolCalls: [{ id, name, input }],
  message: { role: "assistant", content: [...(text ? [{ type: "text", text } as ContentBlock] : []), { type: "tool_use", id, name, input }] },
});
const finalTurn = (text: string): AssistantTurn => ({ text, toolCalls: [], message: { role: "assistant", content: [{ type: "text", text }] } });

function mockProvider(script: AssistantTurn[]) {
  const seen: ChatStreamRequest[] = [];
  let i = 0;
  const provider: CopilotProvider = {
    async run(req, onToken) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const turn = script[Math.min(i, script.length - 1)];
      i++;
      for (const ch of turn.text) onToken(ch);
      return turn;
    },
  };
  return { provider, seen };
}

const echoTool = (ran: unknown[]): ToolDef => ({
  name: "echo", description: "echo", skillId: "core", input_schema: { type: "object" },
  async run(args) { ran.push(args); return { ok: true, summary: "echoed" }; },
});
const dangerTool = (ran: unknown[]): ToolDef => ({
  name: "boom", description: "danger", dangerous: true, skillId: "core", input_schema: { type: "object" },
  async run(args) { ran.push(args); return { ok: true, summary: "boomed" }; },
});

async function drain(gen: AsyncGenerator<CopilotEvent>) {
  const out: CopilotEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("runCopilotTurn", () => {
  it("runs a tool the model asks for, feeds the result back, then emits the final answer", async () => {
    const ran: unknown[] = [];
    const { provider, seen } = mockProvider([toolTurn("tu_1", "echo", { x: 1 }), finalTurn("All set.")]);
    const events = await drain(runCopilotTurn({
      provider, registry: createRegistry([echoTool(ran)]), system: "SYS",
      history: [], userText: "do it", cctx: userCtx(), enabledSkillIds: ["core"], confirm: async () => true,
    }));

    expect(ran).toEqual([{ x: 1 }]); // tool actually executed
    expect(events.find((e) => e.type === "tool_call" && e.name === "echo")).toBeTruthy();
    expect(events.find((e) => e.type === "tool_result" && e.ok && e.summary === "echoed")).toBeTruthy();
    const final = events.at(-1)!;
    expect(final.type).toBe("final");
    expect(final.type === "final" && final.text).toBe("All set.");
    // second model call saw the tool_result fed back
    const lastUser = seen[1].messages.at(-1)!;
    expect(lastUser.role).toBe("user");
    expect(lastUser.content[0].type).toBe("tool_result");
  });

  it("streams text deltas as token events", async () => {
    const { provider } = mockProvider([finalTurn("Hi!")]);
    const events = await drain(runCopilotTurn({
      provider, registry: createRegistry([]), system: "S", history: [], userText: "hi", cctx: userCtx(), enabledSkillIds: ["core"],
    }));
    const tokens = events.filter((e) => e.type === "token").map((e) => (e as any).delta).join("");
    expect(tokens).toBe("Hi!");
  });

  it("stops at maxHops if the model never finishes", async () => {
    const { provider } = mockProvider([toolTurn("tu_x", "echo", {})]); // always a tool call
    const ran: unknown[] = [];
    const events = await drain(runCopilotTurn({
      provider, registry: createRegistry([echoTool(ran)]), system: "S", history: [], userText: "loop",
      cctx: userCtx(), enabledSkillIds: ["core"], confirm: async () => true, maxHops: 3,
    }));
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(3);
    expect(events.at(-1)!.type).toBe("final");
  });

  it("a declined dangerous tool is not executed", async () => {
    const ran: unknown[] = [];
    const { provider } = mockProvider([toolTurn("tu_d", "boom", {}), finalTurn("ok")]);
    const events = await drain(runCopilotTurn({
      provider, registry: createRegistry([dangerTool(ran)]), system: "S", history: [], userText: "boom",
      cctx: userCtx(), enabledSkillIds: ["core"], confirm: async () => false,
    }));
    expect(ran).toHaveLength(0);
    expect(events.find((e) => e.type === "confirm_request")).toBeTruthy();
    expect(events.find((e) => e.type === "tool_result" && !e.ok)).toBeTruthy();
  });

  it("the scheduler actor never runs dangerous tools (no confirm needed)", async () => {
    const ran: unknown[] = [];
    const { provider } = mockProvider([toolTurn("tu_d", "boom", {}), finalTurn("done")]);
    let confirmCalled = false;
    const cctx: CopilotCtx = { app: {} as any, settings: { ...settings }, actor: "scheduler" };
    await drain(runCopilotTurn({
      provider, registry: createRegistry([dangerTool(ran)]), system: "S", history: [], userText: "x",
      cctx, enabledSkillIds: ["core"], confirm: async () => { confirmCalled = true; return true; },
    }));
    expect(ran).toHaveLength(0);
    expect(confirmCalled).toBe(false);
  });

  it("surfaces a provider error as an error event", async () => {
    const provider: CopilotProvider = { async run() { throw new Error("api down"); } };
    const events = await drain(runCopilotTurn({
      provider, registry: createRegistry([]), system: "S", history: [], userText: "hi", cctx: userCtx(), enabledSkillIds: ["core"],
    }));
    expect(events.some((e) => e.type === "error" && e.message.includes("api down"))).toBe(true);
  });
});
