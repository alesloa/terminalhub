import { describe, it, expect } from "vitest";
import {
  CONTEXT_1M_SUFFIX, DEFAULT_GUI_CONFIG, ULTRATHINK_PREFIX, applyUltrathink, bypassesApprovals,
  isGuiEffort, isGuiPermissionMode, parseGuiConfig, sdkEffort, sdkPermissionMode, sdkSettings,
  splitContextWindow, withContextWindow, type GuiConfig, type GuiEffort,
} from "./config.js";

const config = (over: Partial<GuiConfig> = {}): GuiConfig => ({ ...DEFAULT_GUI_CONFIG, ...over });

describe("gui config: sdkEffort", () => {
  it("passes the five real SDK effort levels straight through", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      expect(sdkEffort(effort)).toBe(effort);
    }
  });

  it("maps ultracode to xhigh — it is xhigh plus a setting, not its own API level", () => {
    expect(sdkEffort("ultracode")).toBe("xhigh");
  });

  it("sends no effort for ultrathink (a prompt keyword) or for no choice at all", () => {
    expect(sdkEffort("ultrathink")).toBeUndefined();
    expect(sdkEffort(null)).toBeUndefined();
  });
});

describe("gui config: sdkSettings", () => {
  it("is empty when neither ultracode nor fast mode is picked", () => {
    expect(sdkSettings(config())).toEqual({});
    expect(sdkSettings(config({ effort: "max" }))).toEqual({});
  });

  it("turns the ultracode effort into the ultracode setting", () => {
    expect(sdkSettings(config({ effort: "ultracode" }))).toEqual({ ultracode: true });
  });

  it("carries fast mode, on its own and alongside ultracode", () => {
    expect(sdkSettings(config({ fastMode: true }))).toEqual({ fastMode: true });
    expect(sdkSettings(config({ effort: "ultracode", fastMode: true })))
      .toEqual({ ultracode: true, fastMode: true });
  });
});

describe("gui config: sdkPermissionMode", () => {
  it("maps each composer choice to the SDK's name for it", () => {
    expect(sdkPermissionMode("auto-accept-edits")).toBe("acceptEdits");
    expect(sdkPermissionMode("auto")).toBe("auto");
    expect(sdkPermissionMode("full-access")).toBe("bypassPermissions");
  });

  it("sends nothing for the supervised default — the SDK's own default already means that", () => {
    expect(sdkPermissionMode("approval-required")).toBeUndefined();
  });
});

describe("gui config: bypassesApprovals", () => {
  it("is true only for full access", () => {
    expect(bypassesApprovals(config({ permissionMode: "full-access" }))).toBe(true);
    for (const mode of ["approval-required", "auto-accept-edits", "auto"] as const) {
      expect(bypassesApprovals(config({ permissionMode: mode }))).toBe(false);
    }
  });
});

describe("gui config: applyUltrathink", () => {
  it("prefixes the turn when ultrathink is the chosen depth", () => {
    expect(applyUltrathink("refactor the store", "ultrathink"))
      .toBe(`${ULTRATHINK_PREFIX}refactor the store`);
  });

  it("leaves the turn alone at every other depth", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max", "ultracode"] as GuiEffort[]) {
      expect(applyUltrathink("do the thing", effort)).toBe("do the thing");
    }
    expect(applyUltrathink("do the thing", null)).toBe("do the thing");
  });

  it("is idempotent — re-prefixing an already-prefixed turn is a no-op", () => {
    const once = applyUltrathink("plan it", "ultrathink");
    expect(applyUltrathink(once, "ultrathink")).toBe(once);
  });

  it("adds nothing when the user typed the keyword themselves, anywhere in the sentence", () => {
    expect(applyUltrathink("please ultrathink this one", "ultrathink")).toBe("please ultrathink this one");
    expect(applyUltrathink("ULTRATHINK on the design", "ultrathink")).toBe("ULTRATHINK on the design");
  });

  it("returns empty for blank input rather than a bare prefix", () => {
    expect(applyUltrathink("", "ultrathink")).toBe("");
    expect(applyUltrathink("   \n  ", "ultrathink")).toBe("");
  });

  it("trims either way", () => {
    expect(applyUltrathink("  spaced  ", null)).toBe("spaced");
    expect(applyUltrathink("  spaced  ", "ultrathink")).toBe(`${ULTRATHINK_PREFIX}spaced`);
  });
});

describe("gui config: context window split/join", () => {
  it("splits a 1M model id into its base and the flag", () => {
    expect(splitContextWindow(`claude-fable-5${CONTEXT_1M_SUFFIX}`))
      .toEqual({ base: "claude-fable-5", oneM: true });
  });

  it("reports a plain id as the 200k form", () => {
    expect(splitContextWindow("sonnet")).toEqual({ base: "sonnet", oneM: false });
  });

  it("only matches the suffix at the end", () => {
    expect(splitContextWindow("claude[1m]-preview")).toEqual({ base: "claude[1m]-preview", oneM: false });
  });

  it("round-trips both ways from either form", () => {
    for (const model of ["sonnet", `sonnet${CONTEXT_1M_SUFFIX}`]) {
      expect(withContextWindow(model, true)).toBe(`sonnet${CONTEXT_1M_SUFFIX}`);
      expect(withContextWindow(model, false)).toBe("sonnet");
      const { base, oneM } = splitContextWindow(model);
      expect(withContextWindow(base, oneM)).toBe(model);
    }
  });
});

describe("gui config: type guards", () => {
  it("recognises every effort and rejects anything else", () => {
    for (const effort of ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"]) {
      expect(isGuiEffort(effort)).toBe(true);
    }
    for (const junk of ["", "HIGH", "turbo", 3, null, undefined, {}]) expect(isGuiEffort(junk)).toBe(false);
  });

  it("recognises every permission mode and rejects anything else", () => {
    for (const mode of ["approval-required", "auto-accept-edits", "auto", "full-access"]) {
      expect(isGuiPermissionMode(mode)).toBe(true);
    }
    for (const junk of ["", "bypassPermissions", "yolo", 1, null, []]) expect(isGuiPermissionMode(junk)).toBe(false);
  });
});

describe("gui config: parseGuiConfig", () => {
  it("falls back to the defaults for anything that isn't an object", () => {
    for (const junk of [null, undefined, "", "sonnet", 42, true]) {
      expect(parseGuiConfig(junk)).toEqual(DEFAULT_GUI_CONFIG);
    }
  });

  it("fills a partial object in from the defaults", () => {
    expect(parseGuiConfig({ model: "sonnet" })).toEqual({ ...DEFAULT_GUI_CONFIG, model: "sonnet" });
    expect(parseGuiConfig({ permissionMode: "auto" })).toEqual({ ...DEFAULT_GUI_CONFIG, permissionMode: "auto" });
    expect(parseGuiConfig({})).toEqual(DEFAULT_GUI_CONFIG);
  });

  it("drops field values it doesn't recognise instead of trusting them", () => {
    expect(parseGuiConfig({ model: 42, effort: "banana", permissionMode: "yolo", fastMode: "yes" }))
      .toEqual(DEFAULT_GUI_CONFIG);
  });

  it("keeps a full, valid config verbatim", () => {
    const full: GuiConfig = { model: "claude-fable-5[1m]", effort: "ultracode", permissionMode: "full-access", fastMode: true };
    expect(parseGuiConfig(full)).toEqual(full);
  });

  it("normalises the model: trimmed, and blank means no --model at all", () => {
    expect(parseGuiConfig({ model: "  opus  " }).model).toBe("opus");
    expect(parseGuiConfig({ model: "   " }).model).toBeNull();
    expect(parseGuiConfig({ model: null }).model).toBeNull();
  });

  it("returns a fresh object, never the shared default", () => {
    const parsed = parseGuiConfig(null);
    parsed.fastMode = true;
    expect(DEFAULT_GUI_CONFIG.fastMode).toBe(false);
  });
});
