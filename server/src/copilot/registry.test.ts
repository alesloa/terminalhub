import { describe, it, expect } from "vitest";
import { createRegistry } from "./registry.js";
import type { ToolDef, CopilotCtx } from "./types.js";

const tool = (name: string, skillId: string, extra: Partial<ToolDef> = {}): ToolDef => ({
  name,
  description: `does ${name}`,
  input_schema: { type: "object" },
  skillId,
  async run(args) { return { ok: true, summary: `${name} ran`, data: args }; },
  ...extra,
});

const cctx = {} as CopilotCtx; // tools in these tests ignore the context

describe("tool registry", () => {
  it("registers and gets a tool by name", () => {
    const r = createRegistry([tool("note_add", "core")]);
    expect(r.get("note_add")?.name).toBe("note_add");
    expect(r.get("nope")).toBeUndefined();
  });

  it("collect returns only tools whose skill is enabled", () => {
    const r = createRegistry([tool("note_add", "core"), tool("email_check", "email")]);
    const names = (ids: string[]) => r.collect(ids).map((t) => t.name).sort();
    expect(names(["core"])).toEqual(["note_add"]);
    expect(names(["core", "email"])).toEqual(["email_check", "note_add"]);
    expect(names([])).toEqual([]);
  });

  it("run dispatches to the tool and returns its result", async () => {
    const r = createRegistry([tool("note_add", "core")]);
    const res = await r.run("note_add", { title: "hi" }, cctx);
    expect(res).toEqual({ ok: true, summary: "note_add ran", data: { title: "hi" } });
  });

  it("run on an unknown tool fails gracefully (ok:false, names it)", async () => {
    const r = createRegistry([]);
    const res = await r.run("ghost", {}, cctx);
    expect(res.ok).toBe(false);
    expect(res.summary).toContain("ghost");
  });

  it("preserves the dangerous flag through get", () => {
    const r = createRegistry([tool("terminal_send", "core", { dangerous: true })]);
    expect(r.get("terminal_send")?.dangerous).toBe(true);
  });

  it("register adds a tool after construction", () => {
    const r = createRegistry();
    r.register(tool("board_add_card", "core"));
    expect(r.collect(["core"]).map((t) => t.name)).toEqual(["board_add_card"]);
  });
});
