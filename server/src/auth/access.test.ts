import { describe, it, expect, beforeEach } from "vitest";
import { createStore, type Store } from "../db/store.js";
import { resolvePrincipal, isLockedViewer } from "./access.js";

let store: Store;
beforeEach(() => { store = createStore(":memory:"); });

const ctx = () => ({ store });
const cfg = (token: string | null) => ({ token });

describe("resolvePrincipal", () => {
  it("resolves loopback (relaxed) to the main owner", () => {
    const p = resolvePrincipal(ctx(), cfg(null), { remoteAddr: "127.0.0.1", header: undefined, forwarded: false });
    expect(p).toEqual({ kind: "main" });
  });

  it("resolves an exposed request bearing the main token to the owner", () => {
    const p = resolvePrincipal(ctx(), cfg("S3CRET"), { remoteAddr: "8.8.8.8", header: "Bearer S3CRET", forwarded: true });
    expect(p).toEqual({ kind: "main" });
  });

  it("resolves a valid access-key secret to a key principal (mirror/lock default off)", () => {
    const k = store.createAccessKey({ label: "Bob" });
    const p = resolvePrincipal(ctx(), cfg("S3CRET"), { remoteAddr: "8.8.8.8", header: `Bearer ${k.secret}`, forwarded: true });
    expect(p).toEqual({ kind: "key", keyId: k.id, mirror: false, lock: false });
  });

  it("carries the key's mirror/lock flags onto the principal", () => {
    const k = store.createAccessKey({ label: "Demo", mirror: true, lock: true });
    const p = resolvePrincipal(ctx(), cfg("S3CRET"), { remoteAddr: "8.8.8.8", header: `Bearer ${k.secret}`, forwarded: true });
    expect(p).toEqual({ kind: "key", keyId: k.id, mirror: true, lock: true });
  });

  it("resolves a key secret to a KEY even from a loopback-looking request (tunnel → dev proxy → server)", () => {
    // A teammate reaching the box through a Cloudflare tunnel + Vite dev proxy lands at the server as
    // loopback (the proxy is local; the tunnel's real-IP header doesn't survive the hop). They still
    // present the link's key secret — which MUST win over the loopback-relaxed owner shortcut, or they
    // silently become a second owner and mirroring / admission / lock never engage.
    const k = store.createAccessKey({ label: "ss", mirror: true, lock: true });
    const p = resolvePrincipal(ctx(), cfg("MAINTOK"), { remoteAddr: "127.0.0.1", header: `Bearer ${k.secret}`, forwarded: false });
    expect(p).toEqual({ kind: "key", keyId: k.id, mirror: true, lock: true });
  });

  it("touches lastUsedAt when a key resolves", () => {
    const k = store.createAccessKey({});
    expect(store.listAccessKeys()[0].lastUsedAt).toBeNull();
    resolvePrincipal(ctx(), cfg("S3CRET"), { remoteAddr: "8.8.8.8", header: `Bearer ${k.secret}`, forwarded: true });
    expect(store.listAccessKeys()[0].lastUsedAt).not.toBeNull();
  });

  it("rejects an exposed request with an unknown secret", () => {
    const p = resolvePrincipal(ctx(), cfg("S3CRET"), { remoteAddr: "8.8.8.8", header: "Bearer garbage", forwarded: true });
    expect(p).toBeNull();
  });

  it("rejects an exposed request with no credential at all", () => {
    const p = resolvePrincipal(ctx(), cfg("S3CRET"), { remoteAddr: "8.8.8.8", header: undefined, forwarded: true });
    expect(p).toBeNull();
  });

  it("rejects an expired access-key secret", () => {
    const k = store.createAccessKey({ expiresAt: Date.now() - 1000 });
    const p = resolvePrincipal(ctx(), cfg("S3CRET"), { remoteAddr: "8.8.8.8", header: `Bearer ${k.secret}`, forwarded: true });
    expect(p).toBeNull();
  });

  it("treats the main token as the owner even if it collides with a key path (token wins)", () => {
    // header matches the configured main token → main, never even consulted as a key
    const p = resolvePrincipal(ctx(), cfg("MAINTOK"), { remoteAddr: "8.8.8.8", header: "Bearer MAINTOK", forwarded: true });
    expect(p).toEqual({ kind: "main" });
  });
});

describe("isLockedViewer", () => {
  it("is true only for a key principal whose lock flag is set", () => {
    expect(isLockedViewer({ kind: "key", keyId: "ak_1", mirror: false, lock: true })).toBe(true);
  });

  it("is false for an unlocked key principal", () => {
    expect(isLockedViewer({ kind: "key", keyId: "ak_1", mirror: true, lock: false })).toBe(false);
  });

  it("is false for the main owner (never locked)", () => {
    expect(isLockedViewer({ kind: "main" })).toBe(false);
  });
});
