import { describe, it, expect } from "vitest";
import { isProxyableUrl } from "./proxy.js";

describe("isProxyableUrl", () => {
  it("accepts absolute http/https URLs", () => {
    expect(isProxyableUrl("http://example.com/a.m3u8")).toBe(true);
    expect(isProxyableUrl("https://cdn.example.com/path/index.m3u8?x=1")).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(isProxyableUrl("file:///etc/passwd")).toBe(false);
    expect(isProxyableUrl("ftp://example.com/file")).toBe(false);
    expect(isProxyableUrl("data:text/plain,hi")).toBe(false);
  });

  it("rejects relative and garbage input", () => {
    expect(isProxyableUrl("/relative/path.m3u8")).toBe(false);
    expect(isProxyableUrl("not a url")).toBe(false);
    expect(isProxyableUrl("")).toBe(false);
  });
});
