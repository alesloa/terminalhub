import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeSource, cloneShallow, remoteHead } from "./git.js";

const run = promisify(execFile);

describe("skills/git: normalizeSource", () => {
  it("expands owner/repo shorthand to a GitHub https url", () => {
    expect(normalizeSource("octocat/hello")).toMatchObject({
      cloneUrl: "https://github.com/octocat/hello", sourceType: "github", isLocal: false,
    });
  });
  it("expands github: and gitlab: prefixes", () => {
    expect(normalizeSource("github:o/r").cloneUrl).toBe("https://github.com/o/r");
    expect(normalizeSource("gitlab:o/r")).toMatchObject({ cloneUrl: "https://gitlab.com/o/r", sourceType: "gitlab" });
  });
  it("passes a full https url through and keeps a .git suffix", () => {
    expect(normalizeSource("https://github.com/o/r").cloneUrl).toBe("https://github.com/o/r");
    expect(normalizeSource("https://github.com/o/r.git").cloneUrl).toBe("https://github.com/o/r.git");
  });
  it("extracts ref + subPath from a GitHub /tree/ url", () => {
    expect(normalizeSource("https://github.com/o/r/tree/main/skills/foo")).toMatchObject({
      cloneUrl: "https://github.com/o/r", ref: "main", subPath: "skills/foo", sourceType: "github",
    });
  });
  it("extracts ref + subPath from a GitLab /-/tree/ url", () => {
    expect(normalizeSource("https://gitlab.com/o/r/-/tree/dev/a/b")).toMatchObject({
      cloneUrl: "https://gitlab.com/o/r", ref: "dev", subPath: "a/b", sourceType: "gitlab",
    });
  });
  it("converts a GitHub API git-trees url (the REST tree endpoint) into a clone url + ref", () => {
    expect(normalizeSource("https://api.github.com/repos/anthropics/skills/git/trees/main?recursive=1")).toMatchObject({
      cloneUrl: "https://github.com/anthropics/skills", ref: "main", sourceType: "github", isLocal: false,
    });
    // bare form, no query, trailing slash
    expect(normalizeSource("https://api.github.com/repos/o/r/git/trees/dev/")).toMatchObject({
      cloneUrl: "https://github.com/o/r", ref: "dev",
    });
  });
  it("converts a raw.githubusercontent.com file url into clone url + ref + subPath (folder)", () => {
    expect(normalizeSource("https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md")).toMatchObject({
      cloneUrl: "https://github.com/anthropics/skills", ref: "main", subPath: "skills/pdf", sourceType: "github",
    });
  });
  it("recognizes an scp-style ssh url as a git source", () => {
    expect(normalizeSource("git@github.com:o/r.git")).toMatchObject({
      cloneUrl: "git@github.com:o/r.git", sourceType: "git", isLocal: false,
    });
  });
  it("treats an absolute path as a local source", () => {
    expect(normalizeSource("/abs/local/repo")).toMatchObject({
      cloneUrl: "/abs/local/repo", sourceType: "local", isLocal: true,
    });
  });
});

describe("skills/git: clone + ls-remote against a local repo", () => {
  let root: string, repo: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "skgit-"));
    repo = path.join(root, "src-repo");
    await fs.mkdir(repo, { recursive: true });
    await run("git", ["init", "-q"], { cwd: repo });
    await run("git", ["config", "user.email", "t@t.t"], { cwd: repo });
    await run("git", ["config", "user.name", "t"], { cwd: repo });
    await fs.writeFile(path.join(repo, "SKILL.md"), "---\nname: x\ndescription: d\n---\n");
    await run("git", ["add", "-A"], { cwd: repo });
    await run("git", ["commit", "-qm", "init"], { cwd: repo });
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("cloneShallow copies the working tree into dest", async () => {
    const dest = path.join(root, "clone");
    await cloneShallow(repo, dest);
    expect(await fs.readFile(path.join(dest, "SKILL.md"), "utf8")).toContain("name: x");
  });
  it("remoteHead returns the repo's current HEAD sha", async () => {
    const head = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
    expect(await remoteHead(repo)).toBe(head);
  });
  it("remoteHead returns null for a nonexistent remote", async () => {
    expect(await remoteHead(path.join(root, "does-not-exist"))).toBeNull();
  });
});
