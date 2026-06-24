import { describe, it, expect } from "vitest";
import { parseJsonPaths, uriListToPaths } from "./clipboard.js";

describe("parseJsonPaths", () => {
  it("parses a JSON array of paths", () => {
    expect(parseJsonPaths('["/a/b.txt","/c/dir"]')).toEqual(["/a/b.txt", "/c/dir"]);
  });
  it("tolerates whitespace and empty output", () => {
    expect(parseJsonPaths("  []\n")).toEqual([]);
    expect(parseJsonPaths("")).toEqual([]);
  });
  it("drops non-string / empty entries and returns [] on garbage", () => {
    expect(parseJsonPaths('["/a", 3, "", null]')).toEqual(["/a"]);
    expect(parseJsonPaths("not json")).toEqual([]);
  });
});

describe("uriListToPaths", () => {
  it("extracts file:// URIs and percent-decodes them", () => {
    const list = "file:///tmp/a.txt\r\nfile:///tmp/my%20folder\r\n";
    expect(uriListToPaths(list)).toEqual(["/tmp/a.txt", "/tmp/my folder"]);
  });
  it("ignores comments, blanks and non-file URIs", () => {
    const list = "# comment\n\nhttps://example.com\nfile:///tmp/x";
    expect(uriListToPaths(list)).toEqual(["/tmp/x"]);
  });
});
