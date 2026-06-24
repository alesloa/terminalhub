import { describe, it, expect } from "vitest";
import { MANIFEST, searchFeatures } from "./manifest.js";
import { knowledgeTools } from "./tools.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import type { CopilotCtx, ToolDef } from "../types.js";

const cctx = {} as CopilotCtx;
const find = (name: string) => {
  const t = knowledgeTools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("capability manifest", () => {
  it("has entries, each with the required fields", () => {
    expect(MANIFEST.length).toBeGreaterThan(20);
    for (const e of MANIFEST) {
      expect(e.id).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.blurb).toBeTruthy();
      expect(e.section).toBeTruthy();
    }
  });

  it("ids are unique", () => {
    expect(new Set(MANIFEST.map((e) => e.id)).size).toBe(MANIFEST.length);
  });

  it("searches by keyword across name + blurb", () => {
    const hits = searchFeatures("stage manager");
    expect(hits[0].name.toLowerCase()).toContain("stage");
  });

  it("finds a feature by an action phrase", () => {
    expect(searchFeatures("clone a repo").length).toBeGreaterThan(0);
  });

  it("returns nothing for nonsense", () => {
    expect(searchFeatures("xyzzy-nonexistent-feature")).toEqual([]);
  });
});

describe("knowledge tools", () => {
  it("explain_feature returns matching features", async () => {
    const r = await find("explain_feature").run({ query: "durable terminals" }, cctx);
    expect(r.ok).toBe(true);
    expect((r.data as any[]).length).toBeGreaterThan(0);
  });

  it("explain_feature with no match still succeeds (empty)", async () => {
    const r = await find("explain_feature").run({ query: "zzzznope" }, cctx);
    expect(r.ok).toBe(true);
    expect((r.data as any[]).length).toBe(0);
  });

  it("how_do_i answers a task lookup", async () => {
    const r = await find("how_do_i").run({ task: "set a reminder" }, cctx);
    expect(r.ok).toBe(true);
    expect((r.data as any[]).length).toBeGreaterThan(0);
  });
});

describe("system prompt", () => {
  const tools: ToolDef[] = [
    { name: "note_add", description: "save a note", skillId: "core", input_schema: { type: "object" }, async run() { return { ok: true, summary: "" }; } },
  ];

  it("introduces the product and lists the available tools", () => {
    const sys = buildSystemPrompt({ enabledSkillIds: ["core"], tools });
    expect(sys).toContain("Terminal Hub");
    expect(sys).toContain("note_add");
  });

  it("includes feature knowledge from the manifest", () => {
    const sys = buildSystemPrompt({ enabledSkillIds: ["core"], tools });
    expect(sys.toLowerCase()).toContain("tmux");
  });

  it("surfaces configured skill accounts when provided", () => {
    const sys = buildSystemPrompt({ enabledSkillIds: ["core", "email"], tools, accountsSummary: "Email accounts: Personal (gmail), Work (outlook)" });
    expect(sys).toContain("Personal (gmail)");
  });
});
