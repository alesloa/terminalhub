import { describe, it, expect } from "vitest";
import { isOnPath, detectBuiltins, BUILTIN_AGENTS } from "./registry.js";

describe("agent detection", () => {
  it("finds a binary present in one of the PATH dirs", () => {
    const exists = (p: string) => p === "/usr/local/bin/claude";
    expect(isOnPath("claude", { pathEnv: "/usr/bin:/usr/local/bin", exists })).toBe(true);
  });

  it("returns false when the binary is in no PATH dir", () => {
    expect(isOnPath("nope", { pathEnv: "/usr/bin:/bin", exists: () => false })).toBe(false);
  });

  it("checks an absolute path directly, ignoring PATH", () => {
    const exists = (p: string) => p === "/opt/x/gemini";
    expect(isOnPath("/opt/x/gemini", { pathEnv: "", exists })).toBe(true);
  });

  it("detectBuiltins flags only installed agents and hides the bin field", () => {
    const installed = new Set(["claude", "cursor-agent"]);
    const exists = (p: string) => installed.has(p.split("/").pop()!);
    const out = detectBuiltins({ pathEnv: "/bin", exists });
    expect(out.find(a => a.id === "claude")!.installed).toBe(true);
    expect(out.find(a => a.id === "cursor")!.installed).toBe(true);
    expect(out.find(a => a.id === "codex")!.installed).toBe(false);
    expect((out[0] as any).bin).toBeUndefined();
    expect(out.length).toBe(BUILTIN_AGENTS.length);
  });
});
