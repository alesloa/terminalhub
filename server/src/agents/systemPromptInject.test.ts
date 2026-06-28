import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySystemPrompt } from "./systemPrompt.js";
import { applyManagedBlock, BLOCK_START, SYSTEM_PROMPT_MARKERS } from "../spaces/managedBlock.js";

let folder: string;
let tmpDir: string;

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "th-folder-"));
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "th-tmp-"));
});
afterEach(async () => {
  await fs.rm(folder, { recursive: true, force: true });
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const read = (p: string) => fs.readFile(p, "utf8");
const exists = (p: string) => fs.access(p).then(() => true, () => false);

describe("applySystemPrompt — claude (native flag)", () => {
  it("writes a per-terminal temp file and returns the append-system-prompt-file flag", async () => {
    const inj = await applySystemPrompt("claude", "You are terse.", { folder, tmpDir, terminalId: "tm_1" });
    expect(inj.kind).toBe("flag");
    if (inj.kind !== "flag") throw new Error("expected flag");
    expect(inj.args[0]).toBe("--append-system-prompt-file");
    const file = inj.args[1];
    expect(file.endsWith("tm_1.md")).toBe(true);
    expect(await read(file)).toBe("You are terse.");
  });

  it("does not touch the workspace folder", async () => {
    await applySystemPrompt("claude", "Hi.", { folder, tmpDir, terminalId: "tm_1" });
    expect(await fs.readdir(folder)).toEqual([]);
  });

  it("returns none (no flag) for an empty effective prompt", async () => {
    const inj = await applySystemPrompt("claude", "   ", { folder, tmpDir, terminalId: "tm_1" });
    expect(inj.kind).toBe("none");
  });
});

describe("applySystemPrompt — codex/gemini/opencode (managed block in a folder file)", () => {
  it("writes the system-prompt block into AGENTS.md for codex", async () => {
    const inj = await applySystemPrompt("codex", "Be careful.", { folder, tmpDir, terminalId: "tm_1" });
    expect(inj.kind).toBe("file");
    const content = await read(path.join(folder, "AGENTS.md"));
    expect(content).toContain(SYSTEM_PROMPT_MARKERS.start);
    expect(content).toContain("Be careful.");
  });

  it("writes into GEMINI.md for gemini and AGENTS.md for opencode", async () => {
    await applySystemPrompt("gemini", "G text.", { folder, tmpDir, terminalId: "tm_1" });
    expect(await read(path.join(folder, "GEMINI.md"))).toContain("G text.");
    await applySystemPrompt("opencode", "O text.", { folder, tmpDir, terminalId: "tm_2" });
    expect(await read(path.join(folder, "AGENTS.md"))).toContain("O text.");
  });

  it("preserves the user's hand-authored content and the space-config block", async () => {
    const seeded = applyManagedBlock("# My project\n\nNotes.\n", "Space rules.", "append");
    await fs.writeFile(path.join(folder, "AGENTS.md"), seeded);
    await applySystemPrompt("codex", "System text.", { folder, tmpDir, terminalId: "tm_1" });
    const content = await read(path.join(folder, "AGENTS.md"));
    expect(content).toContain("# My project");
    expect(content).toContain("Notes.");
    expect(content).toContain(BLOCK_START);      // space-config block intact
    expect(content).toContain("Space rules.");
    expect(content).toContain("System text.");   // our block added
  });

  it("strips the system-prompt block (only) when the effective prompt is empty", async () => {
    const seeded = applyManagedBlock("# Keep\n", "Space rules.", "append");
    await fs.writeFile(path.join(folder, "AGENTS.md"), seeded);
    await applySystemPrompt("codex", "System text.", { folder, tmpDir, terminalId: "tm_1" });
    await applySystemPrompt("codex", "", { folder, tmpDir, terminalId: "tm_1" });
    const content = await read(path.join(folder, "AGENTS.md"));
    expect(content).not.toContain(SYSTEM_PROMPT_MARKERS.start);
    expect(content).not.toContain("System text.");
    expect(content).toContain("Space rules.");
    expect(content).toContain("# Keep");
  });
});

describe("applySystemPrompt — cursor (own rule file)", () => {
  it("writes .cursor/rules/terminalhub.mdc with alwaysApply frontmatter", async () => {
    const inj = await applySystemPrompt("cursor", "Cursor rule.", { folder, tmpDir, terminalId: "tm_1" });
    expect(inj.kind).toBe("file");
    const content = await read(path.join(folder, ".cursor", "rules", "terminalhub.mdc"));
    expect(content).toContain("alwaysApply: true");
    expect(content).toContain("Cursor rule.");
  });

  it("removes the rule file when the effective prompt is empty", async () => {
    await applySystemPrompt("cursor", "Cursor rule.", { folder, tmpDir, terminalId: "tm_1" });
    await applySystemPrompt("cursor", "", { folder, tmpDir, terminalId: "tm_1" });
    expect(await exists(path.join(folder, ".cursor", "rules", "terminalhub.mdc"))).toBe(false);
  });
});

describe("applySystemPrompt — unknown / no agent", () => {
  it("returns none and writes nothing for a null agent", async () => {
    const inj = await applySystemPrompt(null, "anything", { folder, tmpDir, terminalId: "tm_1" });
    expect(inj.kind).toBe("none");
    expect(await fs.readdir(folder)).toEqual([]);
  });

  it("returns none for an unrecognized agent id", async () => {
    const inj = await applySystemPrompt("aider", "anything", { folder, tmpDir, terminalId: "tm_1" });
    expect(inj.kind).toBe("none");
    expect(await fs.readdir(folder)).toEqual([]);
  });
});
