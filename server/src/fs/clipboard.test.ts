import { describe, it, expect } from "vitest";
import { parseJsonPaths, uriListToPaths, macWriteScript } from "./clipboard.js";

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

describe("macWriteScript", () => {
  it("targets NSFilenamesPboardType and embeds the paths as a JSON literal", () => {
    const s = macWriteScript(["/a/b.txt", "/c/dir"]);
    expect(s).toContain("NSFilenamesPboardType");
    expect(s).toContain("setPropertyListForType");
    expect(s).toContain('["/a/b.txt","/c/dir"]');
  });
  it("JSON-escapes paths so a quote/backslash can't break out of the script (injection-safe)", () => {
    const weird = '/weird/" + osascript_danger + "/x.txt';
    const s = macWriteScript([weird]);
    expect(s).toContain(JSON.stringify([weird])); // the only place the path appears is escaped JSON
  });
});
