import { describe, it, expect } from "vitest";
import { revealCommand } from "./reveal.js";

describe("revealCommand", () => {
  it("reveals + selects the file in Finder on macOS", () => {
    expect(revealCommand("darwin", "/Users/me/proj/a.ts")).toEqual({ cmd: "open", args: ["-R", "/Users/me/proj/a.ts"] });
  });

  it("selects the file in Explorer on Windows (backslash path)", () => {
    expect(revealCommand("win32", "/c/proj/a.ts")).toEqual({ cmd: "explorer", args: ["/select,\\c\\proj\\a.ts"] });
  });

  it("opens the containing folder via xdg-open on Linux", () => {
    expect(revealCommand("linux", "/home/ale/proj/a.ts")).toEqual({ cmd: "xdg-open", args: ["/home/ale/proj"] });
  });
});
