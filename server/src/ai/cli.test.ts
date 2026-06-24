import { describe, it, expect } from "vitest";
import { cliArgv, CLI_SPECS, CLI_ONESHOT } from "./cli.js";

describe("cliArgv", () => {
  it("claude: prompt on stdin, model via --model", () => {
    const r = cliArgv(["claude", "-p"], "sonnet", "write a commit");
    expect(r.argv).toEqual(["claude", "-p", "--model", "sonnet"]);
    expect(r.stdin).toBe("write a commit");
  });

  it("codex: prompt on stdin, model via -m", () => {
    const r = cliArgv(["codex", "exec"], "gpt-5", "write a commit");
    expect(r.argv).toEqual(["codex", "exec", "-m", "gpt-5"]);
    expect(r.stdin).toBe("write a commit");
  });

  it("gemini: prompt as the -p argument (model -m before -p), empty stdin", () => {
    const r = cliArgv(CLI_ONESHOT.gemini, "gemini-2.5-pro", "write a commit");
    expect(r.argv).toEqual(["gemini", "-o", "text", "-m", "gemini-2.5-pro", "-p", "write a commit"]);
    expect(r.stdin).toBe("");
  });

  it("cursor-agent: prompt as a bare positional at the end, model via --model", () => {
    const r = cliArgv(CLI_ONESHOT.cursor, "sonnet-4", "write a commit");
    expect(r.argv).toEqual(["cursor-agent", "-p", "--output-format", "text", "--model", "sonnet-4", "write a commit"]);
    expect(r.stdin).toBe("");
  });

  it("omits the model flag when no model is set", () => {
    expect(cliArgv(["claude", "-p"], undefined, "hi").argv).toEqual(["claude", "-p"]);
    expect(cliArgv(CLI_ONESHOT.gemini, "  ", "hi").argv).toEqual(["gemini", "-o", "text", "-p", "hi"]);
  });

  it("unknown binary: defaults to stdin with no model flag (today's behaviour)", () => {
    const r = cliArgv(["cat"], "ignored", "echo me");
    expect(r.argv).toEqual(["cat"]);
    expect(r.stdin).toBe("echo me");
  });

  it("every backing endpoint points at a real /models surface and an env var", () => {
    for (const spec of Object.values(CLI_SPECS)) {
      if (!spec.backing) continue;
      expect(spec.backing.baseUrl).toMatch(/^https:\/\//);
      expect(spec.backing.apiKeyEnv).toMatch(/_API_KEY$/);
    }
  });
});
