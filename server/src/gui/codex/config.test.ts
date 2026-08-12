import { describe, it, expect } from "vitest";
import type { CodexModel } from "../../codex/protocol.js";
import { codexEffort, codexPermissions, toGuiModels } from "./config.js";

const model = (over: Partial<CodexModel> = {}): CodexModel => ({
  id: "gpt-5.6-sol", model: "gpt-5.6-sol", displayName: "Sol", description: "Default",
  isDefault: true, hidden: false, defaultReasoningEffort: "low",
  supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "high", description: "" }],
  ...over,
});

describe("codexPermissions", () => {
  it("keeps supervised read-only, so nothing can be written without a yes", () => {
    expect(codexPermissions("approval-required")).toEqual({ approvalPolicy: "untrusted", sandbox: "read-only" });
  });

  it("lets auto-accept-edits write in the folder but still ask to leave it", () => {
    expect(codexPermissions("auto-accept-edits")).toEqual({ approvalPolicy: "on-request", sandbox: "workspace-write" });
  });

  it("distinguishes auto from full access by the sandbox, not the prompting", () => {
    // Both stop asking; only one of them can touch anything outside the workspace.
    expect(codexPermissions("auto")).toEqual({ approvalPolicy: "never", sandbox: "workspace-write" });
    expect(codexPermissions("full-access")).toEqual({ approvalPolicy: "never", sandbox: "danger-full-access" });
  });
});

describe("codexEffort", () => {
  it("passes through the levels codex understands", () => {
    expect(codexEffort("low")).toBe("low");
    expect(codexEffort("ultra")).toBe("ultra");
  });

  it("sends no effort at all for the Claude-only levels", () => {
    expect(codexEffort("ultracode")).toBeUndefined();
    expect(codexEffort("ultrathink")).toBeUndefined();
    expect(codexEffort(null)).toBeUndefined();
  });
});

describe("toGuiModels", () => {
  it("builds picker rows from whatever the CLI advertises", () => {
    expect(toGuiModels([model()])).toEqual([{
      value: "gpt-5.6-sol", displayName: "Sol", description: "Default",
      supportsEffort: true, effortLevels: ["low", "high"], defaultEffort: "low",
      supportsFastMode: false, supportsContext1m: false, base: "gpt-5.6-sol", isDefault: true,
    }]);
  });

  it("carries the CLI's own default-model flag, since Codex has no 'default' row", () => {
    const rows = toGuiModels([model(), model({ id: "gpt-5.6-terra", isDefault: false })]);
    expect(rows.map((r) => r.isDefault)).toEqual([true, false]);
  });

  it("only reports a default the model actually offers", () => {
    // Codex naming a level it doesn't list would put a "Default" chip on a row that isn't there.
    const rows = toGuiModels([model({
      defaultReasoningEffort: "none",
      supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
    })]);
    expect(rows[0].defaultEffort).toBeNull();
  });

  it("drops the models the CLI hides", () => {
    const rows = toGuiModels([model(), model({ id: "internal", hidden: true })]);
    expect(rows.map((r) => r.value)).toEqual(["gpt-5.6-sol"]);
  });

  it("ignores an effort level the picker has no label for", () => {
    const rows = toGuiModels([model({
      supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }, { reasoningEffort: "warp9", description: "" }],
    })]);
    expect(rows[0].effortLevels).toEqual(["high"]);
  });

  it("reports no effort support for a model that lists none", () => {
    const rows = toGuiModels([model({ supportedReasoningEfforts: [] })]);
    expect(rows[0]).toMatchObject({ supportsEffort: false, effortLevels: [] });
  });
});
