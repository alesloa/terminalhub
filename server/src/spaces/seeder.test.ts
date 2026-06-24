import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedWorkspace, envVarNames } from "./seeder.js";
import { EMPTY_SPACE_CONFIG, type SpaceConfig } from "./types.js";
import { BLOCK_START } from "./managedBlock.js";

let home: string, ws: string, prevHome: string | undefined;

const cfg = (over: Partial<SpaceConfig>): SpaceConfig => ({ ...EMPTY_SPACE_CONFIG, ...over });
const read = (rel: string) => fs.readFile(path.join(ws, rel), "utf8");
const exists = (rel: string) => fs.access(path.join(ws, rel)).then(() => true, () => false);

async function writeHome(rel: string, content: string) {
  const p = path.join(home, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}

beforeEach(async () => {
  prevHome = process.env.HOME;
  home = await fs.mkdtemp(path.join(os.tmpdir(), "tr-seed-home-"));
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "tr-seed-ws-"));
  process.env.HOME = home;
});
afterEach(async () => {
  process.env.HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(ws, { recursive: true, force: true });
});

describe("envVarNames", () => {
  it("extracts variable names (not values), skipping comments + blanks + export prefixes", () => {
    expect(envVarNames("# a comment\nFOO=bar\n\nexport BAZ=qux\nnonsense line")).toEqual(["FOO", "BAZ"]);
  });
});

describe("seedWorkspace — rules block", () => {
  it("creates AGENTS.md + CLAUDE.md with the managed block on an empty folder", async () => {
    await seedWorkspace(ws, cfg({ claudeMd: { mode: "append", content: "Use TDD." }, seedTarget: "both" }));
    expect(await read("AGENTS.md")).toContain("Use TDD.");
    expect(await read("CLAUDE.md")).toContain(BLOCK_START);
  });

  it("inserts the block into a hand-authored CLAUDE.md without touching the rest", async () => {
    await fs.writeFile(path.join(ws, "CLAUDE.md"), "# Mine\n\nkeep this\n");
    await seedWorkspace(ws, cfg({ claudeMd: { mode: "append", content: "Seeded." }, seedTarget: "CLAUDE.md" }));
    const out = await read("CLAUDE.md");
    expect(out).toContain("keep this");
    expect(out).toContain("Seeded.");
  });

  it("is idempotent — a second seed leaves the rules file byte-identical", async () => {
    const c = cfg({ claudeMd: { mode: "append", content: "Stable." }, seedTarget: "AGENTS.md" });
    await seedWorkspace(ws, c);
    const first = await read("AGENTS.md");
    await seedWorkspace(ws, c);
    expect(await read("AGENTS.md")).toBe(first);
  });
});

describe("seedWorkspace — skills", () => {
  it("copies a selected global skill into <folder>/.claude/skills and re-run is a no-op", async () => {
    await writeHome(".claude/skills/cool/SKILL.md", "---\nname: Cool\n---\nbody");
    const c = cfg({ skills: ["cool"] });
    await seedWorkspace(ws, c);
    expect(await read(".claude/skills/cool/SKILL.md")).toContain("body");
    // a hand-edit to the seeded copy survives a re-seed (never clobbered)
    await fs.writeFile(path.join(ws, ".claude/skills/cool/SKILL.md"), "EDITED");
    await seedWorkspace(ws, c);
    expect(await read(".claude/skills/cool/SKILL.md")).toBe("EDITED");
  });

  it("skips a selected skill that does not exist globally (no fake folder)", async () => {
    await seedWorkspace(ws, cfg({ skills: ["ghost"] }));
    expect(await exists(".claude/skills/ghost")).toBe(false);
  });
});

describe("seedWorkspace — commands", () => {
  it("copies a selected global command into <folder>/.claude/commands", async () => {
    await writeHome(".claude/commands/deploy.md", "Run the deploy.\n");
    await seedWorkspace(ws, cfg({ commands: ["deploy"] }));
    expect(await read(".claude/commands/deploy.md")).toContain("Run the deploy.");
  });

  it("writes a bundled starter command's content when the user has no global copy", async () => {
    await seedWorkspace(ws, cfg({ commands: ["review"] }));
    const body = await read(".claude/commands/review.md");
    expect(body).toContain("description: Review the current diff");
    expect(body).toContain("git diff against the base branch");
  });

  it("prefers the user's own global command file over the bundled copy", async () => {
    await writeHome(".claude/commands/review.md", "---\ndescription: mine\n---\nMY CUSTOM REVIEW");
    await seedWorkspace(ws, cfg({ commands: ["review"] }));
    expect(await read(".claude/commands/review.md")).toContain("MY CUSTOM REVIEW");
  });

  it("skips a command that is neither global nor bundled (no fake file)", async () => {
    await seedWorkspace(ws, cfg({ commands: ["does-not-exist-anywhere"] }));
    expect(await exists(".claude/commands/does-not-exist-anywhere.md")).toBe(false);
  });
});

describe("seedWorkspace — MCP servers", () => {
  it("writes selected servers into .mcp.json, never clobbering hand-added entries, re-run no-op", async () => {
    await writeHome(".claude.json", JSON.stringify({ mcpServers: { pencil: { command: "pencil", args: ["x"] } } }));
    await fs.writeFile(path.join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { mine: { command: "mine" } } }, null, 2));
    await seedWorkspace(ws, cfg({ mcpServers: ["pencil"] }));
    const j = JSON.parse(await read(".mcp.json"));
    expect(j.mcpServers.pencil).toEqual({ command: "pencil", args: ["x"] });
    expect(j.mcpServers.mine).toEqual({ command: "mine" }); // hand-added untouched
    const before = await read(".mcp.json");
    await seedWorkspace(ws, cfg({ mcpServers: ["pencil"] }));
    expect(await read(".mcp.json")).toBe(before); // idempotent
  });
});

describe("seedWorkspace — env / secrets", () => {
  it("writes .env, gitignores it, and lists only the var NAMES in the rules block", async () => {
    await seedWorkspace(ws, cfg({
      env: "OPENAI_API_KEY=sk-secret\nDATABASE_URL=postgres://x",
      claudeMd: { mode: "append", content: "Rules." }, seedTarget: "AGENTS.md",
    }));
    expect(await read(".env")).toContain("sk-secret");
    expect(await read(".gitignore")).toContain(".env");
    const rules = await read("AGENTS.md");
    expect(rules).toContain("OPENAI_API_KEY");
    expect(rules).toContain("DATABASE_URL");
    expect(rules).not.toContain("sk-secret"); // values never leak into the rules file
  });

  it("never clobbers a hand-authored .env", async () => {
    await fs.writeFile(path.join(ws, ".env"), "HAND=written\n");
    await seedWorkspace(ws, cfg({ env: "FOO=bar" }));
    expect(await read(".env")).toBe("HAND=written\n");
  });
});
