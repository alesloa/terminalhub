import { describe, it, expect } from "vitest";
import { proxyUrl, rewriteManifest } from "./manifest.js";

describe("proxyUrl", () => {
  it("wraps an absolute url through the tv proxy, encoded", () => {
    expect(proxyUrl("https://cdn.example.com/a/b.ts")).toBe(
      "/api/tv/proxy?url=" + encodeURIComponent("https://cdn.example.com/a/b.ts"),
    );
  });

  it("appends encoded referrer and user-agent when given", () => {
    const out = proxyUrl("https://cdn.x/s.ts", "https://ref.example/", "Agent/1.0");
    expect(out).toContain("url=" + encodeURIComponent("https://cdn.x/s.ts"));
    expect(out).toContain("&ref=" + encodeURIComponent("https://ref.example/"));
    expect(out).toContain("&ua=" + encodeURIComponent("Agent/1.0"));
  });
});

describe("rewriteManifest", () => {
  const base = "https://cdn.example.com/live/playlist.m3u8";

  it("rewrites a relative segment line to an absolute proxied url", () => {
    const m = ["#EXTM3U", "#EXTINF:6.0,", "seg1.ts"].join("\n");
    const out = rewriteManifest(m, base);
    expect(out).toContain("/api/tv/proxy?url=" + encodeURIComponent("https://cdn.example.com/live/seg1.ts"));
  });

  it("leaves comment and tag lines untouched", () => {
    const m = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXTINF:6.0,", "seg1.ts"].join("\n");
    const out = rewriteManifest(m, base).split("\n");
    expect(out[0]).toBe("#EXTM3U");
    expect(out[1]).toBe("#EXT-X-VERSION:3");
    expect(out[2]).toBe("#EXTINF:6.0,");
  });

  it("rewrites an absolute child url through the proxy", () => {
    const m = ["#EXTM3U", "#EXTINF:6.0,", "https://other.cdn/x/seg.ts"].join("\n");
    const out = rewriteManifest(m, base);
    expect(out).toContain("/api/tv/proxy?url=" + encodeURIComponent("https://other.cdn/x/seg.ts"));
  });

  it("rewrites the URI inside an EXT-X-KEY tag", () => {
    const m = ['#EXT-X-KEY:METHOD=AES-128,URI="enc.key",IV=0x1', "seg.ts"].join("\n");
    const out = rewriteManifest(m, base);
    expect(out).toContain('URI="/api/tv/proxy?url=' + encodeURIComponent("https://cdn.example.com/live/enc.key") + '"');
  });

  it("threads referrer and user-agent into every rewritten url", () => {
    const m = ["#EXTM3U", "#EXTINF:6.0,", "seg1.ts"].join("\n");
    const out = rewriteManifest(m, base, "https://ref.example/", "Agent/1.0");
    expect(out).toContain("&ref=" + encodeURIComponent("https://ref.example/"));
    expect(out).toContain("&ua=" + encodeURIComponent("Agent/1.0"));
  });

  it("preserves blank lines", () => {
    const m = ["#EXTM3U", "", "#EXTINF:6.0,", "seg1.ts"].join("\n");
    const out = rewriteManifest(m, base).split("\n");
    expect(out[1]).toBe("");
  });
});
