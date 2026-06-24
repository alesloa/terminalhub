import { describe, it, expect, beforeEach } from "vitest";
import { createStore, type Store } from "./store.js";

let store: Store;
beforeEach(() => { store = createStore(":memory:"); });

describe("store: space widgets", () => {
  it("creates, lists, updates geometry, and round-trips config JSON", () => {
    const w = store.createSpaceWidget({ spaceId: "sp_1", kind: "world-clock", x: 10, y: 20, w: 300, h: 200, config: { cities: ["UTC"] } });
    expect(w.id).toMatch(/^sw_/);
    expect(w.kind).toBe("world-clock");
    expect(store.getSpaceWidget(w.id)?.config).toEqual({ cities: ["UTC"] });

    store.updateSpaceWidget(w.id, { x: 99, y: 88, w: 320 });
    const got = store.getSpaceWidget(w.id)!;
    expect(got.x).toBe(99);
    expect(got.y).toBe(88);
    expect(got.w).toBe(320);
    expect(got.h).toBe(200); // untouched fields persist

    expect(store.listSpaceWidgets().map((r) => r.id)).toContain(w.id);
  });

  it("defaults config to null and deletes", () => {
    const w = store.createSpaceWidget({ spaceId: null, kind: "claude-meter", x: 0, y: 0, w: 100, h: 100 });
    expect(store.getSpaceWidget(w.id)?.config).toBeNull();
    store.deleteSpaceWidget(w.id);
    expect(store.getSpaceWidget(w.id)).toBeUndefined();
  });
});
