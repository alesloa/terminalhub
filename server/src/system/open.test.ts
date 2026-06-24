import { describe, it, expect } from "vitest";
import { openCommand } from "./open.js";

describe("openCommand", () => {
  it("opens the path in the default app on macOS", () => {
    expect(openCommand("darwin", "/Users/me/proj/a.ts")).toEqual({ cmd: "open", args: ["/Users/me/proj/a.ts"] });
  });

  it("opens via start on Windows", () => {
    expect(openCommand("win32", "C:/proj/a.ts")).toEqual({ cmd: "cmd", args: ["/c", "start", "", "C:/proj/a.ts"] });
  });

  it("opens via xdg-open on Linux", () => {
    expect(openCommand("linux", "/home/ale/proj/a.ts")).toEqual({ cmd: "xdg-open", args: ["/home/ale/proj/a.ts"] });
  });
});
