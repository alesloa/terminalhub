import { describe, it, expect, vi } from "vitest";
import { createNotifyBus, notifyCategory, type Notification } from "./bus.js";

const sample = (text = "hi"): Notification =>
  ({ id: "nf_1", text, level: "info", category: "agent", source: "notify", speak: true, ts: 0 });

describe("notify bus", () => {
  it("wraps a published notification as a frame and delivers it to every subscriber", () => {
    const bus = createNotifyBus();
    const a = vi.fn(), b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    const n = sample();
    bus.publish(n);
    expect(a).toHaveBeenCalledWith({ type: "notification", ...n });
    expect(b).toHaveBeenCalledWith({ type: "notification", ...n });
  });

  it("delivers control frames (removed / changed) to subscribers", () => {
    const bus = createNotifyBus();
    const fn = vi.fn();
    bus.subscribe(fn);
    bus.emit({ type: "removed", id: "nf_1" });
    bus.emit({ type: "changed" });
    expect(fn).toHaveBeenNthCalledWith(1, { type: "removed", id: "nf_1" });
    expect(fn).toHaveBeenNthCalledWith(2, { type: "changed" });
  });

  it("stops delivering after unsubscribe", () => {
    const bus = createNotifyBus();
    const fn = vi.fn();
    const off = bus.subscribe(fn);
    off();
    bus.publish(sample());
    expect(fn).not.toHaveBeenCalled();
  });

  it("a throwing subscriber doesn't block the others", () => {
    const bus = createNotifyBus();
    const bad = vi.fn(() => { throw new Error("dead socket"); });
    const good = vi.fn();
    bus.subscribe(bad);
    bus.subscribe(good);
    expect(() => bus.publish(sample())).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });
});

describe("notifyCategory", () => {
  it("promotes error/warn to 'error' regardless of source", () => {
    expect(notifyCategory("error", "notify")).toBe("error");
    expect(notifyCategory("warn", "attention")).toBe("error");
    expect(notifyCategory("error", "reminder")).toBe("error");
  });
  it("maps agent sources to 'agent' and everything else to 'info'", () => {
    expect(notifyCategory("info", "attention")).toBe("agent");
    expect(notifyCategory("success", "notify")).toBe("agent");
    expect(notifyCategory("info", "reminder")).toBe("info");
  });
});
