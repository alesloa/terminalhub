import { describe, it, expect } from "vitest";
import type { Terminal, Workspace } from "../types.js";
import { guiAgentFor, guiAgentForCommand } from "./agent.js";

describe("guiAgentForCommand", () => {
  it("recognises codex however it is invoked", () => {
    expect(guiAgentForCommand("codex")).toBe("codex");
    expect(guiAgentForCommand("codex --search --model gpt-5.6-sol")).toBe("codex");
    expect(guiAgentForCommand("/opt/homebrew/bin/codex")).toBe("codex");
    expect(guiAgentForCommand("headroom wrap codex")).toBe("codex");
  });

  it("treats everything else as Claude — that is what GUI mode has always meant", () => {
    expect(guiAgentForCommand("claude")).toBe("claude");
    expect(guiAgentForCommand("gemini")).toBe("claude");
    expect(guiAgentForCommand("")).toBe("claude");
    expect(guiAgentForCommand(null)).toBe("claude");
  });

  it("does not match a command that merely mentions codex", () => {
    expect(guiAgentForCommand("npm run codex")).toBe("claude");
  });
});

describe("guiAgentFor", () => {
  const ws = { id: "ws_1", folder: "/w", launchCommand: "claude" } as Workspace;
  const term = (over: Partial<Terminal> = {}) => ({ id: "tm_1", workspaceId: "ws_1", ...over } as Terminal);

  it("prefers the terminal's own launch command over the workspace default", () => {
    expect(guiAgentFor(term({ launchCommandOverride: "codex" }), ws)).toBe("codex");
  });

  it("inherits the workspace command when the terminal sets none", () => {
    expect(guiAgentFor(term({ launchCommandOverride: null }), { ...ws, launchCommand: "codex" })).toBe("codex");
  });

  it("stays on Claude for a plain shell terminal", () => {
    // An empty override is a deliberate plain shell, not "inherit" — and a plain shell has no agent
    // of its own, so the chat behind it is the default one.
    expect(guiAgentFor(term({ launchCommandOverride: "" }), { ...ws, launchCommand: "codex" })).toBe("claude");
  });
});
