import { describe, it, expect } from "vitest";
import { createStore } from "./store.js";

describe("copilot conversation + message persistence", () => {
  it("creates a conversation with a co_ id and equal timestamps", () => {
    const store = createStore(":memory:");
    const c = store.createCopilotConversation("Morning check");
    expect(c.id).toMatch(/^co_/);
    expect(c.title).toBe("Morning check");
    expect(c.updatedAt).toBe(c.createdAt);
  });

  it("lists conversations newest-updated first", () => {
    const store = createStore(":memory:");
    const a = store.createCopilotConversation("a");
    const b = store.createCopilotConversation("b");
    store.touchCopilotConversation(a.id); // a becomes most-recently-updated
    expect(store.listCopilotConversations().map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it("stores and reads back messages in insertion order, content preserved", () => {
    const store = createStore(":memory:");
    const c = store.createCopilotConversation();
    store.addCopilotMessage({ conversationId: c.id, role: "user", content: '[{"type":"text","text":"hi"}]' });
    store.addCopilotMessage({ conversationId: c.id, role: "assistant", content: '[{"type":"text","text":"hello"}]' });
    const msgs = store.listCopilotMessages(c.id);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1].content).toBe('[{"type":"text","text":"hello"}]');
  });

  it("renames a conversation and bumps updatedAt", () => {
    const store = createStore(":memory:");
    const c = store.createCopilotConversation();
    store.updateCopilotConversation(c.id, { title: "Renamed" });
    const got = store.getCopilotConversation(c.id);
    expect(got?.title).toBe("Renamed");
    expect(got!.updatedAt).toBeGreaterThanOrEqual(c.createdAt);
  });

  it("deleting a conversation cascades its messages", () => {
    const store = createStore(":memory:");
    const c = store.createCopilotConversation();
    store.addCopilotMessage({ conversationId: c.id, role: "user", content: "[]" });
    store.deleteCopilotConversation(c.id);
    expect(store.getCopilotConversation(c.id)).toBeUndefined();
    expect(store.listCopilotMessages(c.id)).toEqual([]);
  });

  it("getCopilotConversation is undefined for a missing id", () => {
    const store = createStore(":memory:");
    expect(store.getCopilotConversation("co_nope")).toBeUndefined();
  });
});
