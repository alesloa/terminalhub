import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStore, type Store } from "../db/store.js";
import { createNotifyBus, type NotifyBus, type NotifyFrame } from "./bus.js";
import { createPendingNotifier, type PendingNotifier, type PendingInput } from "./pending.js";

let store: Store;
let notify: NotifyBus;
let frames: NotifyFrame[];
let pending: PendingNotifier;

const input = (text = "done"): PendingInput =>
  ({ text, level: "info", category: "agent", source: "notify", speak: false, terminalId: "tm_1", workspaceId: "ws_1" });

beforeEach(() => {
  vi.useFakeTimers();
  store = createStore(":memory:");
  notify = createNotifyBus();
  frames = [];
  notify.subscribe((f) => frames.push(f));
  pending = createPendingNotifier({ store, notify, delayMs: 10_000 });
});
afterEach(() => { pending.stop(); vi.useRealTimers(); });

describe("pending notifier", () => {
  it("shows a toast immediately but does NOT persist until the grace window lapses", () => {
    pending.fire(input());
    expect(frames.filter((f) => f.type === "notification")).toHaveLength(1); // toast now
    expect(store.listNotifications()).toHaveLength(0);                       // not in the center yet

    vi.advanceTimersByTime(10_000);
    const notes = store.listNotifications();
    expect(notes).toHaveLength(1);                                          // ignored → persisted
    expect(notes[0].category).toBe("agent");
    expect(notes[0].terminalId).toBe("tm_1");
    expect(frames.some((f) => f.type === "changed")).toBe(true);            // center refreshes
  });

  it("resolving before the window lapses cancels the persist and drops the toast everywhere", () => {
    const id = pending.fire(input());
    expect(pending.resolve(id)).toBe(true);
    vi.advanceTimersByTime(10_000);

    expect(store.listNotifications()).toHaveLength(0);                      // never reached the center
    expect(frames.some((f) => f.type === "removed" && f.id === id)).toBe(true);
  });

  it("resolving an unknown / already-persisted id is a harmless no-op", () => {
    const id = pending.fire(input());
    vi.advanceTimersByTime(10_000);                                         // persists, drops from pending
    expect(pending.resolve(id)).toBe(false);
    expect(store.listNotifications()).toHaveLength(1);                      // stays as history
  });
});
