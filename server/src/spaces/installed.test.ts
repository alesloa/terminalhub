import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readInstalled } from "./installed.js";

// "Installed in this workspace" = everything ACTIVE for the agent in this folder, each tagged by scope:
//   local  — pinned to THIS folder: <folder>/.claude/{skills,commands}, <folder>/.mcp.json,
//            and local-scope MCP (~/.claude.json projects[folder]).
//   global — user-scope, active in every project: ~/.claude/{skills,commands}.
// MCP is special: per product decision MCP servers are ALWAYS shown local (the user treats their MCP
// set as part of each workspace), so user-scope top-level mcpServers are folded in as scope "local".
// A name present both local and global collapses to a single entry, local winning.

let home: string, ws: string, prevHome: string | undefined;
const writeIn = async (root: string, rel: string, content: string) => {
  const p = path.join(root, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
};

beforeEach(async () => {
  prevHome = process.env.HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "tr-installed-home-"));
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "tr-installed-ws-"));
  process.env.HOME = home;
});
afterEach(async () => {
  process.env.HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(ws, { recursive: true, force: true });
});

describe("readInstalled", () => {
  it("empty workspace + empty home → nothing installed", async () => {
    expect(await readInstalled(ws)).toEqual({ skills: [], commands: [], mcpServers: [] });
  });

  it("user-scope globals show tagged 'global'; user-scope MCP shows as 'local'", async () => {
    await writeIn(home, ".claude.json", JSON.stringify({ mcpServers: { "asana-alex": {} } }));
    await writeIn(home, ".claude/skills/caveman/SKILL.md", "x");
    await writeIn(home, ".claude/commands/commit.md", "x");
    expect(await readInstalled(ws)).toEqual({
      skills: [{ name: "caveman", scope: "global" }],
      commands: [{ name: "commit", scope: "global" }],
      mcpServers: [{ name: "asana-alex", scope: "local" }], // MCP always local
    });
  });

  it("project-local files show tagged 'local'", async () => {
    await writeIn(ws, ".claude/skills/p-skill/SKILL.md", "x");
    await writeIn(ws, ".claude/commands/p-cmd.md", "x");
    await writeIn(ws, ".mcp.json", JSON.stringify({ mcpServers: { projMcp: {} } }));
    expect(await readInstalled(ws)).toEqual({
      skills: [{ name: "p-skill", scope: "local" }],
      commands: [{ name: "p-cmd", scope: "local" }],
      mcpServers: [{ name: "projMcp", scope: "local" }],
    });
  });

  it("a name present both local and global collapses to one entry, local wins", async () => {
    await writeIn(home, ".claude/skills/shared/SKILL.md", "x"); // global
    await writeIn(ws, ".claude/skills/shared/SKILL.md", "x"); // local
    expect((await readInstalled(ws)).skills).toEqual([{ name: "shared", scope: "local" }]);
  });

  it("MCP merges project .mcp.json + local-scope + user-scope, all local, deduped + sorted", async () => {
    await writeIn(ws, ".mcp.json", JSON.stringify({ mcpServers: { shared: {} } }));
    await writeIn(home, ".claude.json", JSON.stringify({
      mcpServers: { userTop: {} },
      projects: { [ws]: { mcpServers: { shared: {}, extra: {} } } },
    }));
    expect((await readInstalled(ws)).mcpServers).toEqual([
      { name: "extra", scope: "local" },
      { name: "shared", scope: "local" },
      { name: "userTop", scope: "local" },
    ]);
  });

  it("ignores stray non-skill files and sorts skills", async () => {
    await writeIn(ws, ".claude/skills/zeta/SKILL.md", "x");
    await writeIn(ws, ".claude/skills/alpha/SKILL.md", "x");
    await writeIn(ws, ".claude/skills/loose.txt", "stray — ignored");
    expect((await readInstalled(ws)).skills).toEqual([
      { name: "alpha", scope: "local" },
      { name: "zeta", scope: "local" },
    ]);
  });

  it("malformed project .mcp.json never throws", async () => {
    await writeIn(ws, ".mcp.json", "{ not valid json");
    expect((await readInstalled(ws)).mcpServers).toEqual([]);
  });
});
