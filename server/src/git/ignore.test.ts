import { describe, it, expect } from "vitest";
import { ignoreLine, appendIgnoreLine } from "./ignore.js";

describe("ignoreLine", () => {
  it("anchors a file path with a leading slash", () => {
    expect(ignoreLine("web/src/foo.ts", false)).toBe("/web/src/foo.ts");
  });
  it("adds a trailing slash for directories so the rule matches the dir only", () => {
    expect(ignoreLine("dist", true)).toBe("/dist/");
  });
  it("handles dotfiles", () => {
    expect(ignoreLine(".env", false)).toBe("/.env");
  });
});

describe("appendIgnoreLine", () => {
  it("writes the line with a trailing newline into an empty file", () => {
    expect(appendIgnoreLine("", "/foo")).toBe("/foo\n");
  });
  it("appends after existing content that ends in a newline", () => {
    expect(appendIgnoreLine("a\nb\n", "/foo")).toBe("a\nb\n/foo\n");
  });
  it("adds the missing newline before appending when the file doesn't end in one", () => {
    expect(appendIgnoreLine("a\nb", "/foo")).toBe("a\nb\n/foo\n");
  });
  it("returns null (no-op) when the exact line is already present", () => {
    expect(appendIgnoreLine("/foo\n", "/foo")).toBeNull();
    expect(appendIgnoreLine("a\n/foo\nb\n", "/foo")).toBeNull();
  });
  it("matches ignoring surrounding whitespace on existing lines", () => {
    expect(appendIgnoreLine("  /foo  \n", "/foo")).toBeNull();
  });
});
