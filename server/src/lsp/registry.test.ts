import { describe, it, expect } from "vitest";
import {
  BUILTIN_LANGUAGE_SERVERS,
  detectLanguageServers,
  serverForLanguageId,
} from "./registry.js";

describe("language-server registry", () => {
  it("maps a language id to its server and reflects installed state", () => {
    const exists = (p: string) => p === "/usr/local/bin/typescript-language-server";
    const got = serverForLanguageId("typescript", { pathEnv: "/usr/bin:/usr/local/bin", exists });
    expect(got?.id).toBe("typescript-language-server");
    expect(got?.bin).toBe("typescript-language-server");
    expect(got?.args).toEqual(["--stdio"]);
    expect(got?.installed).toBe(true);
  });

  it("maps typescriptreact (tsx) to the same TypeScript server", () => {
    const got = serverForLanguageId("typescriptreact", { pathEnv: "/bin", exists: () => false });
    expect(got?.id).toBe("typescript-language-server");
    expect(got?.installed).toBe(false);
  });

  it("maps rust to rust-analyzer", () => {
    const got = serverForLanguageId("rust", { pathEnv: "/bin", exists: () => true });
    expect(got?.id).toBe("rust-analyzer");
  });

  it("returns null for a language with no known server", () => {
    expect(serverForLanguageId("cobol", { pathEnv: "/bin", exists: () => true })).toBeNull();
  });

  it("detectLanguageServers flags installed servers and hides bin/args", () => {
    const installed = new Set(["pyright-langserver", "gopls"]);
    const exists = (p: string) => installed.has(p.split("/").pop()!);
    const out = detectLanguageServers({ pathEnv: "/bin", exists });

    expect(out.length).toBe(BUILTIN_LANGUAGE_SERVERS.length);
    expect(out.find((s) => s.id === "pyright")!.installed).toBe(true);
    expect(out.find((s) => s.id === "gopls")!.installed).toBe(true);
    expect(out.find((s) => s.id === "rust-analyzer")!.installed).toBe(false);
    expect((out[0] as any).bin).toBeUndefined();
    expect((out[0] as any).args).toBeUndefined();
  });

  it("every builtin carries language ids, a probe bin, and an install hint", () => {
    for (const def of BUILTIN_LANGUAGE_SERVERS) {
      expect(def.languageIds.length).toBeGreaterThan(0);
      expect(def.bin).toBeTruthy();
      expect(def.installHint).toBeTruthy();
    }
  });
});
