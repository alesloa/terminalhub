import { describe, it, expect } from "vitest";
import { resolveEffective } from "./systemPrompt.js";

describe("resolveEffective", () => {
  it("returns the agent global when there are no workspace or terminal overrides", () => {
    expect(resolveEffective("You are Claude.", null, null)).toBe("You are Claude.");
  });

  it("appends the workspace text under the global by default (includeGlobal=true)", () => {
    const out = resolveEffective("GLOBAL", { text: "WS", includeGlobal: true }, null);
    expect(out).toBe("GLOBAL\n\nWS");
  });

  it("drops the global when the workspace opts out (includeGlobal=false)", () => {
    const out = resolveEffective("GLOBAL", { text: "WS only", includeGlobal: false }, null);
    expect(out).toBe("WS only");
  });

  it("appends terminal text under global+workspace by default (includeParent=true)", () => {
    const out = resolveEffective(
      "GLOBAL",
      { text: "WS", includeGlobal: true },
      { text: "TERM", includeParent: true },
    );
    expect(out).toBe("GLOBAL\n\nWS\n\nTERM");
  });

  it("drops everything above when the terminal opts out (includeParent=false)", () => {
    const out = resolveEffective(
      "GLOBAL",
      { text: "WS", includeGlobal: true },
      { text: "TERM only", includeParent: false },
    );
    expect(out).toBe("TERM only");
  });

  it("a blank workspace layer that includes the global passes the global through", () => {
    const out = resolveEffective("GLOBAL", { text: "  ", includeGlobal: true }, null);
    expect(out).toBe("GLOBAL");
  });

  it("a blank terminal layer that includes its parent passes global+workspace through", () => {
    const out = resolveEffective(
      "GLOBAL",
      { text: "WS", includeGlobal: true },
      { text: "", includeParent: true },
    );
    expect(out).toBe("GLOBAL\n\nWS");
  });

  it("trims each layer and joins with a blank line", () => {
    const out = resolveEffective("  GLOBAL  ", { text: "\nWS\n", includeGlobal: true }, null);
    expect(out).toBe("GLOBAL\n\nWS");
  });

  it("returns empty string when every contributing layer is blank", () => {
    expect(resolveEffective("", { text: "", includeGlobal: true }, { text: "", includeParent: true })).toBe("");
  });

  it("a workspace that excludes the global but has blank text yields empty", () => {
    expect(resolveEffective("GLOBAL", { text: "", includeGlobal: false }, null)).toBe("");
  });
});
