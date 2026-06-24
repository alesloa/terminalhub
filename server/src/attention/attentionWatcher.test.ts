import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAttentionWatcher } from "./attentionWatcher.js";
import type { AttentionItem } from "./attention.js";

// Mock the pending notifier — the watcher's job is the diff (fire on new bell, resolve on bell-clear);
// the persist-if-ignored behavior is the notifier's own concern (see notify/pending.test.ts).
let pending: { fire: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn> };

const item = (terminalId: string, title = "claude"): AttentionItem =>
  ({ terminalId, workspaceId: "ws_1", workspaceName: "Proj", title });

beforeEach(() => {
  let n = 0;
  pending = { fire: vi.fn(() => `pn_${n++}`), resolve: vi.fn() };
});

describe("attention watcher", () => {
  it("seeds pre-existing bells on the first tick without firing", async () => {
    let attn = [item("tm_1")];
    const w = createAttentionWatcher({ pending, getAttention: async () => attn });
    await w.tick();
    expect(pending.fire).not.toHaveBeenCalled();
    void attn;
  });

  it("fires a pending agent notification when a terminal newly rings", async () => {
    let attn: AttentionItem[] = [];
    const w = createAttentionWatcher({ pending, getAttention: async () => attn });
    await w.tick();             // seed (nothing ringing)
    attn = [item("tm_1")];
    await w.tick();

    expect(pending.fire).toHaveBeenCalledTimes(1);
    expect(pending.fire).toHaveBeenCalledWith(expect.objectContaining({
      category: "agent", source: "attention", terminalId: "tm_1", workspaceId: "ws_1",
    }));
  });

  it("does not re-fire while the same bell stays set", async () => {
    let attn: AttentionItem[] = [];
    const w = createAttentionWatcher({ pending, getAttention: async () => attn });
    await w.tick();
    attn = [item("tm_1")];
    await w.tick();
    await w.tick();
    expect(pending.fire).toHaveBeenCalledTimes(1);
  });

  it("resolves the pending notification when the bell clears", async () => {
    let attn: AttentionItem[] = [];
    const w = createAttentionWatcher({ pending, getAttention: async () => attn });
    await w.tick();
    attn = [item("tm_1")];
    await w.tick();
    const id = pending.fire.mock.results[0].value;
    attn = [];
    await w.tick();
    expect(pending.resolve).toHaveBeenCalledWith(id);
  });

  it("re-fires after a bell clears and rings again", async () => {
    let attn: AttentionItem[] = [];
    const w = createAttentionWatcher({ pending, getAttention: async () => attn });
    await w.tick();
    attn = [item("tm_1")]; await w.tick();
    attn = []; await w.tick();
    attn = [item("tm_1")]; await w.tick();
    expect(pending.fire).toHaveBeenCalledTimes(2);
  });
});
