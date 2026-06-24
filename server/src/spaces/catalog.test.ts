import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSpaceCatalog, readGlobalMcpServers } from "./catalog.js";

let home: string;
let prevHome: string | undefined;

async function write(rel: string, content: string) {
  const p = path.join(home, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}

beforeEach(async () => {
  prevHome = process.env.HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "tr-catalog-"));
  process.env.HOME = home;
});
afterEach(async () => {
  process.env.HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
});

describe("listSpaceCatalog", () => {
  it("lists global skills with their frontmatter name + description", async () => {
    await write(".claude/skills/my-skill/SKILL.md", "---\nname: My Skill\ndescription: Does a thing.\n---\nbody");
    const cat = await listSpaceCatalog();
    expect(cat.skills).toEqual([{ name: "my-skill", displayName: "My Skill", description: "Does a thing.", category: "Code" }]);
  });

  it("tags each card with a topic category, honoring a frontmatter `category` override", async () => {
    await write(".claude/skills/frontend-helper/SKILL.md", "---\nname: Frontend Helper\ndescription: UI design work.\n---\nbody");
    await write(".claude/skills/tagged/SKILL.md", "---\nname: Tagged\ndescription: anything\ncategory: Productivity\n---\nbody");
    const cat = await listSpaceCatalog();
    const byName = Object.fromEntries(cat.skills.map((s) => [s.name, s.category]));
    expect(byName["frontend-helper"]).toBe("Design");
    expect(byName["tagged"]).toBe("Productivity");
  });

  it("folds a YAML block-scalar description (`description: >`) into readable card text", async () => {
    await write(".claude/skills/folded/SKILL.md",
      "---\nname: Folded\ndescription: >\n  First clause here\n  and the second clause.\n---\nbody");
    const cat = await listSpaceCatalog();
    expect(cat.skills[0].description).toBe("First clause here and the second clause.");
  });

  it("lists global slash commands by filename with their description", async () => {
    await write(".claude/commands/deploy.md", "---\ndescription: Ship it.\n---\nRun the deploy.");
    await write(".claude/commands/plain.md", "Just do the thing.\n");
    const cat = await listSpaceCatalog();
    const byName = Object.fromEntries(cat.commands.map((c) => [c.name, c.description]));
    expect(byName.deploy).toBe("Ship it.");
    expect(byName.plain).toBe("Just do the thing.");
  });

  it("offers the bundled starter commands when the user has no globals of their own", async () => {
    const cat = await listSpaceCatalog();
    const names = cat.commands.map((c) => c.name);
    expect(names).toContain("commit");
    expect(names).toContain("review");
    expect(names).toContain("security-review");
    expect(cat.commands.length).toBeGreaterThanOrEqual(20);
  });

  it("a user's own global command overrides the bundled one of the same name (no duplicate)", async () => {
    await write(".claude/commands/review.md", "---\ndescription: My custom review.\n---\nbody");
    const cat = await listSpaceCatalog();
    const reviews = cat.commands.filter((c) => c.name === "review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0].description).toBe("My custom review.");
  });

  it("hides a bundled command whose name already exists as a global skill (it's already /name)", async () => {
    await write(".claude/skills/commit/SKILL.md", "---\nname: Commit\n---\nbody");
    const cat = await listSpaceCatalog();
    const names = cat.commands.map((c) => c.name);
    expect(names).not.toContain("commit"); // /commit already comes from the global skill
    expect(names).toContain("review"); // unrelated bundled commands still offered
  });

  it("lists global MCP servers with a transport + a summary description", async () => {
    await write(".claude.json", JSON.stringify({
      mcpServers: {
        local: { command: "npx", args: ["-y", "@scope/server"] },
        remote: { type: "sse", url: "https://example.com/sse" },
      },
    }));
    const cat = await listSpaceCatalog();
    const byName = Object.fromEntries(cat.mcpServers.map((m) => [m.name, m]));
    expect(byName.local.transport).toBe("stdio");
    expect(byName.local.description).toContain("npx");
    expect(byName.remote.transport).toBe("sse");
    expect(byName.remote.description).toContain("example.com");
  });

  it("returns no fake skill/mcp cards when nothing is configured globally (commands carry the bundled pack)", async () => {
    const cat = await listSpaceCatalog();
    expect(cat.skills).toEqual([]);
    expect(cat.mcpServers).toEqual([]);
    expect(cat.commands.length).toBeGreaterThan(0); // the bundled starter commands
  });
});

describe("readGlobalMcpServers", () => {
  it("returns the raw server config objects verbatim for the seeder to copy", async () => {
    await write(".claude.json", JSON.stringify({ mcpServers: { foo: { command: "foo", args: ["--bar"] } } }));
    expect(readGlobalMcpServers()).toEqual({ foo: { command: "foo", args: ["--bar"] } });
  });

  it("returns {} when ~/.claude.json is missing or malformed", async () => {
    expect(readGlobalMcpServers()).toEqual({});
    await write(".claude.json", "{ not json");
    expect(readGlobalMcpServers()).toEqual({});
  });
});
