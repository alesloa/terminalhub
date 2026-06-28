import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContext, type AppContext } from "../context.js";
import { streamTurn, loadHistory, resolveCopilotProvider } from "./service.js";
import type { AssistantTurn, CopilotProvider, ContentBlock } from "./types.js";
import type { CopilotEvent as Ev } from "./agent.js";

let app: AppContext;
beforeEach(() => { app = createContext(":memory:"); });
afterEach(() => { app.pending.stop(); });

const finalTurn = (text: string): AssistantTurn => ({ text, toolCalls: [], message: { role: "assistant", content: [{ type: "text", text }] } });
const toolTurn = (id: string, name: string, input: unknown): AssistantTurn => ({
  text: "", toolCalls: [{ id, name, input }],
  message: { role: "assistant", content: [{ type: "tool_use", id, name, input } as ContentBlock] },
});
function mockProvider(script: AssistantTurn[]): { provider: CopilotProvider; seen: any[] } {
  const seen: any[] = []; let i = 0;
  return { seen, provider: { async run(req, onToken) { seen.push(JSON.parse(JSON.stringify(req))); const t = script[Math.min(i, script.length - 1)]; i++; for (const ch of t.text) onToken(ch); return t; } } };
}

describe("resolveCopilotProvider", () => {
  it("errors clearly when no AI engine is configured", () => {
    const r = resolveCopilotProvider(app);
    expect("error" in r).toBe(true);
  });

  it("resolves a CLI engine (driven over the JSON text protocol)", () => {
    app.store.setAiConfig({ providers: [{ id: "ai_cli", kind: "cli", label: "Claude CLI", enabled: true, command: ["claude"] }], defaultProviderId: "ai_cli" });
    const r = resolveCopilotProvider(app);
    expect("provider" in r).toBe(true);
  });

  it("resolves an Anthropic engine", () => {
    app.store.setAiConfig({ providers: [{ id: "ai_an", kind: "anthropic", label: "Claude", enabled: true, model: "claude-x", apiKey: "k" }], defaultProviderId: "ai_an" });
    const r = resolveCopilotProvider(app);
    expect("provider" in r).toBe(true);
  });
});

describe("streamTurn", () => {
  it("runs a turn, persists the transcript, and returns the final text", async () => {
    const conv = app.store.createCopilotConversation();
    const { provider, seen } = mockProvider([toolTurn("tu_1", "note_add", { content: "buy milk" }), finalTurn("Done — saved your note.")]);
    const events: Ev[] = [];
    const res = await streamTurn({ app, provider, conversationId: conv.id, userText: "note: buy milk", actor: "user", onEvent: (e) => events.push(e), confirm: async () => true });

    expect(res.finalText).toBe("Done — saved your note.");
    // the real core tool ran
    expect(app.store.listNotes().some((n) => n.content === "buy milk")).toBe(true);
    // transcript persisted: user, assistant(tool_use), user(tool_result), assistant(final)
    const msgs = app.store.listCopilotMessages(conv.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // the model's 2nd call saw the tool_result fed back
    expect(seen[1].messages.at(-1).content[0].type).toBe("tool_result");
    // events forwarded
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.at(-1)!.type).toBe("final");
  });

  it("titles a fresh conversation from the first user message", async () => {
    const conv = app.store.createCopilotConversation();
    const { provider } = mockProvider([finalTurn("ok")]);
    await streamTurn({ app, provider, conversationId: conv.id, userText: "check my email please", actor: "user", onEvent: () => {} });
    expect(app.store.getCopilotConversation(conv.id)!.title.length).toBeGreaterThan(0);
  });

  it("carries prior history into the next turn", async () => {
    const conv = app.store.createCopilotConversation();
    const a = mockProvider([finalTurn("first")]);
    await streamTurn({ app, provider: a.provider, conversationId: conv.id, userText: "hello", actor: "user", onEvent: () => {} });
    const b = mockProvider([finalTurn("second")]);
    await streamTurn({ app, provider: b.provider, conversationId: conv.id, userText: "again", actor: "user", onEvent: () => {} });
    // second turn's request carried the earlier exchange (history) before the new user msg
    expect(b.seen[0].messages.length).toBeGreaterThan(1);
    expect(loadHistory(app, conv.id).length).toBe(4); // hello, first, again, second
  });
});
