import { describe, it, expect } from "vitest";
import type { CodexAppServer } from "../../codex/appServer.js";
import { CODEX_METHOD, type CodexTurn } from "../../codex/protocol.js";
import { countUserTurns, listSkills } from "./thread.js";

/** A server whose only job is to answer `skills/list` with whatever the test hands it. */
function fakeServer(answer: unknown | (() => never)): CodexAppServer {
  return {
    request: async (method: string) => {
      expect(method).toBe(CODEX_METHOD.skillsList);
      if (typeof answer === "function") return answer();
      return answer;
    },
  } as unknown as CodexAppServer;
}

const turn = (items: CodexTurn["items"]): CodexTurn => ({ id: "t", items, status: "completed" });

describe("countUserTurns", () => {
  it("counts human messages, not turns — steering puts two in one turn", () => {
    expect(countUserTurns([
      turn([
        { type: "userMessage", id: "u1", content: [] },
        { type: "agentMessage", id: "a1", text: "x" },
        { type: "userMessage", id: "u2", content: [] },
      ]),
      turn([{ type: "userMessage", id: "u3", content: [] }]),
    ])).toBe(3);
  });

  it("is zero for a fresh thread", () => {
    expect(countUserTurns([])).toBe(0);
    expect(countUserTurns([turn([{ type: "agentMessage", id: "a", text: "hi" }])])).toBe(0);
  });
});

describe("listSkills", () => {
  it("turns the folder's skills into composer commands", async () => {
    const commands = await listSkills(fakeServer({
      data: [{ cwd: "/w", skills: [{ name: "review", shortDescription: "Review the diff", description: "long" }] }],
    }), "/w");
    expect(commands).toEqual([{ name: "review", description: "Review the diff", argumentHint: "" }]);
  });

  it("falls back to the long description when there is no short one", async () => {
    const commands = await listSkills(fakeServer({
      data: [{ cwd: "/w", skills: [{ name: "deploy", description: "Ship it" }] }],
    }), "/w");
    expect(commands[0].description).toBe("Ship it");
  });

  it("skips disabled skills and repeats of the same name", async () => {
    const commands = await listSkills(fakeServer({
      data: [
        { cwd: "/w", skills: [{ name: "a" }, { name: "off", enabled: false }] },
        { cwd: "/w", skills: [{ name: "a" }] },
      ],
    }), "/w");
    expect(commands.map((c) => c.name)).toEqual(["a"]);
  });

  it("answers with no commands rather than failing the composer", async () => {
    expect(await listSkills(fakeServer(() => { throw new Error("method not found"); }), "/w")).toEqual([]);
    expect(await listSkills(fakeServer(null), "/w")).toEqual([]);
  });
});
