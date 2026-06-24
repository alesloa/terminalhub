import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createStore, type Store } from "./store.js";

let store: Store;
beforeEach(() => { store = createStore(":memory:"); });

describe("store: access keys — create", () => {
  it("mints a key with an ak_ id, a long random secret, and null defaults", () => {
    const k = store.createAccessKey({ label: "Bob - review" });
    expect(k.id).toMatch(/^ak_/);
    expect(k.label).toBe("Bob - review");
    expect(k.secret.length).toBeGreaterThan(20);
    expect(k.secret).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    expect(k.workspaceId).toBeNull();
    expect(k.expiresAt).toBeNull();
    expect(k.lastUsedAt).toBeNull();
    expect(typeof k.createdAt).toBe("number");
  });

  it("defaults the label to an empty string and carries workspaceId + expiresAt", () => {
    const k = store.createAccessKey({ workspaceId: "ws_abc", expiresAt: 999 });
    expect(k.label).toBe("");
    expect(k.workspaceId).toBe("ws_abc");
    expect(k.expiresAt).toBe(999);
  });

  it("gives every key a distinct secret", () => {
    const a = store.createAccessKey({});
    const b = store.createAccessKey({});
    expect(a.secret).not.toBe(b.secret);
  });

  it("defaults mirror and lock to false (a plain link mirrors nothing and locks no one)", () => {
    const k = store.createAccessKey({ label: "plain" });
    expect(k.mirror).toBe(false);
    expect(k.lock).toBe(false);
  });

  it("persists mirror/lock and reads them back as real booleans (not 0/1)", () => {
    const k = store.createAccessKey({ label: "demo", mirror: true, lock: true });
    expect(k.mirror).toBe(true);
    expect(k.lock).toBe(true);
    // round-trips through both read paths as booleans
    expect(store.getValidAccessKey(k.secret)).toMatchObject({ mirror: true, lock: true });
    expect(store.listAccessKeys()[0]).toMatchObject({ mirror: true, lock: true });
  });

  it("carries mirror/lock independently (mirror on, lock off)", () => {
    const k = store.createAccessKey({ mirror: true, lock: false });
    expect(store.getValidAccessKey(k.secret)).toMatchObject({ mirror: true, lock: false });
  });
});

describe("store: access keys — list", () => {
  afterEach(() => vi.useRealTimers());

  it("returns keys newest-createdAt first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const first = store.createAccessKey({ label: "first" });
    vi.setSystemTime(2000);
    const second = store.createAccessKey({ label: "second" });
    const list = store.listAccessKeys();
    expect(list.map((k) => k.id)).toEqual([second.id, first.id]);
  });
});

describe("store: access keys — getValidAccessKey", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the key for a matching, unexpired secret", () => {
    const k = store.createAccessKey({ label: "x" });
    expect(store.getValidAccessKey(k.secret)?.id).toBe(k.id);
  });

  it("returns undefined for an unknown secret", () => {
    store.createAccessKey({});
    expect(store.getValidAccessKey("not-a-real-secret")).toBeUndefined();
  });

  it("returns undefined for an expired secret and sweeps the row away", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const k = store.createAccessKey({ expiresAt: 9_000 }); // already past
    expect(store.getValidAccessKey(k.secret)).toBeUndefined();
    expect(store.listAccessKeys()).toHaveLength(0);
  });

  it("still returns a key whose expiry is in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const k = store.createAccessKey({ expiresAt: 20_000 });
    expect(store.getValidAccessKey(k.secret)?.id).toBe(k.id);
  });
});

describe("store: access keys — revoke", () => {
  it("deletes the key so its secret no longer validates", () => {
    const k = store.createAccessKey({});
    store.revokeAccessKey(k.id);
    expect(store.getValidAccessKey(k.secret)).toBeUndefined();
    expect(store.listAccessKeys()).toHaveLength(0);
  });
});

describe("store: access keys — sweep", () => {
  afterEach(() => vi.useRealTimers());

  it("deletes only expired rows and returns the count removed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    store.createAccessKey({ label: "expired", expiresAt: 5_000 });
    const live = store.createAccessKey({ label: "live", expiresAt: 50_000 });
    const never = store.createAccessKey({ label: "never" }); // expiresAt null
    expect(store.sweepAccessKeys()).toBe(1);
    expect(store.listAccessKeys().map((k) => k.id).sort()).toEqual([live.id, never.id].sort());
  });
});

describe("store: access keys — touch throttle", () => {
  afterEach(() => vi.useRealTimers());

  it("sets lastUsedAt on first touch, then skips touches within 60s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const k = store.createAccessKey({});
    store.touchAccessKey(k.id);
    const t1 = store.listAccessKeys()[0].lastUsedAt;
    expect(t1).toBe(100_000);
    vi.setSystemTime(130_000); // +30s, inside the throttle window
    store.touchAccessKey(k.id);
    expect(store.listAccessKeys()[0].lastUsedAt).toBe(100_000); // unchanged
  });

  it("updates lastUsedAt again once the 60s window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const k = store.createAccessKey({});
    store.touchAccessKey(k.id);
    vi.setSystemTime(161_000); // +61s
    store.touchAccessKey(k.id);
    expect(store.listAccessKeys()[0].lastUsedAt).toBe(161_000);
  });
});
