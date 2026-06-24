import { describe, it, expect } from "vitest";
import { mergeSpaceConfig } from "./merge.js";
import { EMPTY_SPACE_CONFIG, type SpaceConfig } from "./types.js";

const cfg = (p: Partial<SpaceConfig>): SpaceConfig => ({ ...EMPTY_SPACE_CONFIG, ...p });

describe("mergeSpaceConfig", () => {
  it("unions the pick-lists and dedupes (space base + workspace overlay)", () => {
    const base = cfg({ skills: ["a", "b"], commands: ["x"], mcpServers: ["m1"] });
    const over = cfg({ skills: ["b", "c"], commands: ["y"], mcpServers: ["m1", "m2"] });
    const m = mergeSpaceConfig(base, over);
    expect(m.skills).toEqual(["a", "b", "c"]);
    expect(m.commands).toEqual(["x", "y"]);
    expect(m.mcpServers).toEqual(["m1", "m2"]);
  });

  it("concatenates env blocks, dropping an empty side (no stray blank lines)", () => {
    expect(mergeSpaceConfig(cfg({ env: "A=1" }), cfg({ env: "B=2" })).env).toBe("A=1\nB=2");
    expect(mergeSpaceConfig(cfg({ env: "" }), cfg({ env: "B=2" })).env).toBe("B=2");
    expect(mergeSpaceConfig(cfg({ env: "A=1" }), cfg({ env: "" })).env).toBe("A=1");
  });

  it("concatenates rules content (space first, then workspace)", () => {
    const m = mergeSpaceConfig(cfg({ claudeMd: { mode: "pin", content: "Space rules." } }),
                               cfg({ claudeMd: { mode: "append", content: "Workspace rules." } }));
    expect(m.claudeMd.content).toBe("Space rules.\n\nWorkspace rules.");
    expect(m.claudeMd.mode).toBe("pin"); // the base (space) mode wins for the combined block
  });

  it("returns the non-empty side verbatim when the other is empty", () => {
    const only = cfg({ skills: ["a"], env: "A=1", claudeMd: { mode: "append", content: "hi" } });
    expect(mergeSpaceConfig(EMPTY_SPACE_CONFIG, only)).toEqual(only);
    expect(mergeSpaceConfig(only, EMPTY_SPACE_CONFIG)).toEqual(only);
  });

  it("keeps the widest seedTarget union (both > single)", () => {
    expect(mergeSpaceConfig(cfg({ seedTarget: "CLAUDE.md" }), cfg({ seedTarget: "AGENTS.md" })).seedTarget).toBe("both");
    expect(mergeSpaceConfig(cfg({ seedTarget: "CLAUDE.md" }), cfg({ seedTarget: "CLAUDE.md" })).seedTarget).toBe("CLAUDE.md");
  });
});
