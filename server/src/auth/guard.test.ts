import { describe, it, expect } from "vitest";
import { isLoopback, authorize } from "./guard.js";

describe("isLoopback", () => {
  it("recognizes loopback addresses", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("192.168.1.5")).toBe(false);
  });
});

describe("authorize", () => {
  const token = "secret";
  it("allows loopback with no token configured", () => {
    expect(authorize({ remoteAddr: "127.0.0.1", header: undefined, forwarded: false, token: null })).toBe(true);
  });
  it("allows loopback even when token set (relaxed) ", () => {
    expect(authorize({ remoteAddr: "127.0.0.1", header: undefined, forwarded: false, token })).toBe(true);
  });
  it("requires token when forwarded via tunnel", () => {
    expect(authorize({ remoteAddr: "127.0.0.1", header: undefined, forwarded: true, token })).toBe(false);
    expect(authorize({ remoteAddr: "127.0.0.1", header: "Bearer secret", forwarded: true, token })).toBe(true);
  });
  it("requires token when remote is non-loopback", () => {
    expect(authorize({ remoteAddr: "10.0.0.2", header: undefined, forwarded: false, token })).toBe(false);
    expect(authorize({ remoteAddr: "10.0.0.2", header: "Bearer secret", forwarded: false, token })).toBe(true);
  });
});
