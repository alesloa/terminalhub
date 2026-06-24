import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContext, type AppContext } from "../../context.js";
import { listSkills, getSkill, isSkillEnabled, enabledSkills, collectTools, skillCards } from "./registry.js";

let app: AppContext;
beforeEach(() => { app = createContext(":memory:"); });
afterEach(() => { app.pending.stop(); });

describe("skill registry", () => {
  it("includes the built-in core skill", () => {
    const core = getSkill("core");
    expect(core?.builtin).toBe(true);
    expect(core?.examples.length).toBeGreaterThan(0);
    expect(listSkills().some((s) => s.id === "core")).toBe(true);
  });

  it("core is always enabled, even with an empty DB", () => {
    expect(isSkillEnabled(app, getSkill("core")!)).toBe(true);
    expect(enabledSkills(app).map((s) => s.id)).toContain("core");
  });

  it("collectTools exposes the core tools while core is enabled", () => {
    const names = collectTools(app).map((t) => t.name);
    expect(names).toContain("note_add");
    expect(names).toContain("reminder_set");
    expect(names).toContain("explain_feature");
  });

  it("skillCards reports each skill's live enabled state", () => {
    const cards = skillCards(app);
    const core = cards.find((c) => c.id === "core")!;
    expect(core.enabled).toBe(true);
    expect(core.builtin).toBe(true);
  });
});

describe("per-skill state persistence", () => {
  it("an unconfigured skill has no state (disabled)", () => {
    expect(app.store.getCopilotSkillState("email")).toBeUndefined();
  });

  it("enabling persists, and settings merge independently", () => {
    app.store.setCopilotSkillState("email", { enabled: true });
    expect(app.store.getCopilotSkillState("email")).toEqual({ enabled: true, settings: {} });
    app.store.setCopilotSkillState("email", { settings: { poll: 15 } });
    const s = app.store.getCopilotSkillState("email")!;
    expect(s.enabled).toBe(true);            // unchanged by the settings-only patch
    expect(s.settings).toEqual({ poll: 15 });
  });
});
