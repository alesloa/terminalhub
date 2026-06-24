import { describe, it, expect } from "vitest";
import { isOfficialSource } from "./trust.js";

describe("skills/trust: isOfficialSource", () => {
  it("marks known first-party vendor orgs as official", () => {
    expect(isOfficialSource("anthropics/skills")).toBe(true);
    expect(isOfficialSource("https://github.com/openai/skills")).toBe(true);
    expect(isOfficialSource("https://github.com/anthropics/skills.git")).toBe(true);
    expect(isOfficialSource("git@github.com:pytorch/pytorch.git")).toBe(true);
    // the GitHub API trees url normalizes to the repo first, so its owner is still detected
    expect(isOfficialSource("https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1")).toBe(true);
  });

  it("marks community owners and local paths as unofficial", () => {
    expect(isOfficialSource("alirezarezvani/claude-skills")).toBe(false);
    expect(isOfficialSource("obra/superpowers")).toBe(false);
    expect(isOfficialSource("/abs/local/skills")).toBe(false);
    expect(isOfficialSource("./relative/path")).toBe(false);
  });

  it("is case-insensitive on the owner", () => {
    expect(isOfficialSource("Anthropics/Skills")).toBe(true);
  });
});
