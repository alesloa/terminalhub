import { describe, it, expect } from "vitest";
import { sessionName, parseSession, isTerminalHubSession } from "./names.js";

describe("tmux session names", () => {
  it("builds tr_<ws>_<tm>", () => {
    expect(sessionName("ws_abc", "tm_xyz")).toBe("tr_ws_abc_tm_xyz");
  });
  it("recognizes Terminal Hub sessions", () => {
    expect(isTerminalHubSession("tr_ws_abc_tm_xyz")).toBe(true);
    expect(isTerminalHubSession("other")).toBe(false);
  });
  it("parses workspace and terminal ids back out", () => {
    expect(parseSession("tr_ws_abc_tm_xyz")).toEqual({ workspaceId: "ws_abc", terminalId: "tm_xyz" });
    expect(parseSession("nope")).toBeNull();
  });
});
