import { describe, it, expect } from "vitest";
import { sessionLinkFromLaunch, terminalsRunningSession, type SessionLink } from "./terminalLink.js";

const UUID = "aaaa1111-2222-3333-4444-555566667777";

describe("sessionLinkFromLaunch", () => {
  it("parses a plain claude resume", () => {
    expect(sessionLinkFromLaunch(`claude --resume ${UUID}`)).toEqual({ agent: "claude", sessionId: UUID });
  });

  it("parses a claude resume with a model flag before --resume", () => {
    expect(sessionLinkFromLaunch(`claude --model "opus[1m]" --resume ${UUID}`)).toEqual({ agent: "claude", sessionId: UUID });
  });

  it("parses the headroom-wrapped claude resume", () => {
    expect(sessionLinkFromLaunch(`headroom wrap claude --model "opus[1m]" --resume ${UUID}`)).toEqual({ agent: "claude", sessionId: UUID });
  });

  it("parses a codex resume (plain + headroom-wrapped)", () => {
    expect(sessionLinkFromLaunch(`codex resume ${UUID}`)).toEqual({ agent: "codex", sessionId: UUID });
    expect(sessionLinkFromLaunch(`headroom wrap codex resume ${UUID}`)).toEqual({ agent: "codex", sessionId: UUID });
  });

  it("returns null for a fresh launch or no command", () => {
    expect(sessionLinkFromLaunch("claude")).toBeNull();
    expect(sessionLinkFromLaunch("codex")).toBeNull();
    expect(sessionLinkFromLaunch(null)).toBeNull();
    expect(sessionLinkFromLaunch(undefined)).toBeNull();
  });
});

describe("terminalsRunningSession", () => {
  const link: SessionLink = { agent: "claude", sessionId: UUID };
  // panePid must NOT be called — used to assert the cheap launch-only path took over.
  const throwPid = async (): Promise<number | undefined> => { throw new Error("panePid should not be called"); };
  // Simulates "no live session detected" — detectSessionForPid short-circuits on an undefined pid.
  const noSession = async (): Promise<number | undefined> => undefined;

  it("matches via launch command alone when every candidate launch-matches (no PID walk)", async () => {
    const terms = [{ id: "tm_a", tmuxSession: "s_a", launchCommandOverride: `claude --model "opus[1m]" --resume ${UUID}` }];
    const out = await terminalsRunningSession(link, terms, "/work/proj", throwPid);
    expect(out.map((t) => t.id)).toEqual(["tm_a"]);
  });

  it("keeps only the terminal resuming this session", async () => {
    const terms = [
      { id: "tm_a", tmuxSession: "s_a", launchCommandOverride: `claude --resume ${UUID}` },
      { id: "tm_b", tmuxSession: "s_b", launchCommandOverride: `claude --resume different-id` }, // PID-walked → no live session
    ];
    const out = await terminalsRunningSession(link, terms, "/work/proj", noSession);
    expect(out.map((t) => t.id)).toEqual(["tm_a"]);
  });

  it("does not cross agents — a codex resume of the same id isn't a claude match", async () => {
    const terms = [{ id: "tm_c", tmuxSession: "s_c", launchCommandOverride: `codex resume ${UUID}` }];
    const out = await terminalsRunningSession(link, terms, "/work/proj", noSession);
    expect(out).toHaveLength(0);
  });

  it("never PID-walks for codex (no PID files) — codex matching is launch-only", async () => {
    const codexLink: SessionLink = { agent: "codex", sessionId: UUID };
    const terms = [{ id: "tm_d", tmuxSession: "s_d", launchCommandOverride: "codex" }]; // fresh codex, no link
    const out = await terminalsRunningSession(codexLink, terms, "/work/proj", throwPid);
    expect(out).toHaveLength(0);
  });
});
