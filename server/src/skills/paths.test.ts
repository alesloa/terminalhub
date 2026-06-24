import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { skillsDir, disabledDir, assertSafe, sanitizeFolderName, scopeOf } from "./paths.js";

const HOME = "/tmp/home-skills-test";
let prevHome: string | undefined;
beforeEach(() => { prevHome = process.env.HOME; process.env.HOME = HOME; });
afterEach(() => { process.env.HOME = prevHome; });

describe("skills/paths: directory resolution", () => {
  it("global skills + disabled dirs live under ~/.claude", () => {
    expect(skillsDir("global")).toBe(path.join(HOME, ".claude", "skills"));
    expect(disabledDir("global")).toBe(path.join(HOME, ".claude", "skills-disabled"));
  });
  it("workspace skills + disabled dirs live under <workspace>/.claude", () => {
    const ws = "/work/proj";
    expect(skillsDir("workspace", ws)).toBe(path.join(ws, ".claude", "skills"));
    expect(disabledDir("workspace", ws)).toBe(path.join(ws, ".claude", "skills-disabled"));
  });
  it("workspace scope without a folder throws", () => {
    expect(() => skillsDir("workspace")).toThrow();
    expect(() => disabledDir("workspace")).toThrow();
  });
});

describe("skills/paths: assertSafe guard", () => {
  const ws = "/work/proj";
  it("accepts a skill folder under each of the four allowed roots", () => {
    expect(assertSafe(path.join(HOME, ".claude/skills/foo"))).toBe(path.join(HOME, ".claude/skills/foo"));
    expect(assertSafe(path.join(HOME, ".claude/skills-disabled/foo"))).toBe(path.join(HOME, ".claude/skills-disabled/foo"));
    expect(assertSafe(path.join(ws, ".claude/skills/foo"), ws)).toBe(path.join(ws, ".claude/skills/foo"));
    expect(assertSafe(path.join(ws, ".claude/skills-disabled/foo"), ws)).toBe(path.join(ws, ".claude/skills-disabled/foo"));
  });
  it("accepts a file nested inside a skill folder (SKILL.md reads)", () => {
    expect(assertSafe(path.join(HOME, ".claude/skills/foo/SKILL.md"))).toContain("SKILL.md");
  });
  it("rejects paths outside every root", () => {
    expect(() => assertSafe("/etc/passwd")).toThrow();
    expect(() => assertSafe(path.join(HOME, "other/thing"))).toThrow();
  });
  it("rejects traversal that escapes a root", () => {
    expect(() => assertSafe(path.join(HOME, ".claude/skills/../../../etc/passwd"))).toThrow();
  });
  it("rejects the skills root itself (no segment below it)", () => {
    expect(() => assertSafe(path.join(HOME, ".claude/skills"))).toThrow();
  });
  it("rejects a workspace path when no workspace folder is supplied", () => {
    expect(() => assertSafe(path.join(ws, ".claude/skills/foo"))).toThrow();
  });
});

describe("skills/paths: sanitizeFolderName", () => {
  it("keeps safe characters", () => {
    expect(sanitizeFolderName("pdf-tools_v2.1")).toBe("pdf-tools_v2.1");
  });
  it("replaces unsafe characters with dashes", () => {
    expect(sanitizeFolderName("my skill!/name")).toBe("my-skill-name");
  });
  it("strips leading dots and dashes so no hidden or traversal folder", () => {
    expect(sanitizeFolderName("../../etc")).toBe("etc");
    expect(sanitizeFolderName(".hidden")).toBe("hidden");
  });
  it("falls back to 'skill' when nothing survives", () => {
    expect(sanitizeFolderName("...")).toBe("skill");
  });
});

describe("skills/paths: scopeOf", () => {
  const ws = "/work/proj";
  it("classifies a global path as global", () => {
    expect(scopeOf(path.join(HOME, ".claude/skills/foo"), ws)).toBe("global");
  });
  it("classifies a workspace path as workspace", () => {
    expect(scopeOf(path.join(ws, ".claude/skills/foo"), ws)).toBe("workspace");
    expect(scopeOf(path.join(ws, ".claude/skills-disabled/foo"), ws)).toBe("workspace");
  });
});
