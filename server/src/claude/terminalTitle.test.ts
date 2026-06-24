import { describe, it, expect } from "vitest";
import { claudeTerminalTitle, firstWords } from "./terminalTitle.js";

describe("firstWords", () => {
  it("caps to six words and collapses whitespace", () => {
    expect(firstWords("fix the login bug for the restaurant app today")).toBe("fix the login bug for the");
    expect(firstWords("  hello   world  ")).toBe("hello world");
    expect(firstWords("short one")).toBe("short one");
  });
});

describe("claudeTerminalTitle", () => {
  it("names from the first prompt, capped to six words, with no agent prefix", () => {
    expect(claudeTerminalTitle("fix the login bug for the restaurant app"))
      .toBe("fix the login bug for the");
  });

  it("prefers a custom session name, verbatim (not word-capped)", () => {
    expect(claudeTerminalTitle("a much longer first prompt that would be capped", "Restaurant app"))
      .toBe("Restaurant app");
  });

  it("returns null when there's nothing to name from yet", () => {
    expect(claudeTerminalTitle(null, null)).toBeNull();
    expect(claudeTerminalTitle("   ", "")).toBeNull();
    expect(claudeTerminalTitle(undefined, undefined)).toBeNull();
  });
});
