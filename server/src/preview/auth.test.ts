import { describe, it, expect } from "vitest";
import { readCookie, previewAuthorized, PREVIEW_COOKIE } from "./auth.js";

describe("readCookie", () => {
  it("returns the named cookie value", () => {
    expect(readCookie("tr_preview=abc", "tr_preview")).toBe("abc");
  });

  it("finds the value among several cookies and trims whitespace", () => {
    expect(readCookie("a=1; tr_preview=abc ; b=2", "tr_preview")).toBe("abc");
  });

  it("url-decodes the value", () => {
    expect(readCookie("tr_preview=a%20b", "tr_preview")).toBe("a b");
  });

  it("returns undefined when absent or the header is empty", () => {
    expect(readCookie("a=1; b=2", "tr_preview")).toBeUndefined();
    expect(readCookie(undefined, "tr_preview")).toBeUndefined();
  });
});

describe("previewAuthorized", () => {
  const base = {
    remoteAddr: "127.0.0.1",
    authorization: undefined,
    cookie: undefined,
    queryToken: undefined,
    forwarded: false,
    token: "secret" as string | null,
  };

  it("relaxes loopback requests with no credential", () => {
    expect(previewAuthorized(base)).toBe(true);
  });

  it("rejects an exposed request with no credential", () => {
    expect(previewAuthorized({ ...base, forwarded: true })).toBe(false);
  });

  it("accepts an exposed request carrying the token in the preview cookie", () => {
    expect(previewAuthorized({ ...base, forwarded: true, cookie: `${PREVIEW_COOKIE}=secret` })).toBe(true);
  });

  it("rejects an exposed request whose cookie token is wrong", () => {
    expect(previewAuthorized({ ...base, forwarded: true, cookie: `${PREVIEW_COOKIE}=nope` })).toBe(false);
  });

  it("accepts the token via ?token= query param", () => {
    expect(previewAuthorized({ ...base, forwarded: true, queryToken: "secret" })).toBe(true);
  });

  it("accepts the token via the Authorization header", () => {
    expect(previewAuthorized({ ...base, forwarded: true, authorization: "Bearer secret" })).toBe(true);
  });

  it("treats a non-loopback remote address as exposed", () => {
    expect(previewAuthorized({ ...base, remoteAddr: "203.0.113.9" })).toBe(false);
    expect(previewAuthorized({ ...base, remoteAddr: "203.0.113.9", cookie: `${PREVIEW_COOKIE}=secret` })).toBe(true);
  });
});
