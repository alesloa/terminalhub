import { describe, it, expect } from "vitest";
import { DEFAULT_PR_INSTRUCTIONS, buildPrPrompt, splitPrMessage } from "./pr.js";

describe("buildPrPrompt", () => {
  it("uses the built-in instructions and appends the commits + files", () => {
    const p = buildPrPrompt("- feat: add widget", "M\tsrc/x.ts", undefined);
    expect(p).toContain(DEFAULT_PR_INSTRUCTIONS);
    expect(p).toContain("Commits on the branch");
    expect(p).toContain("- feat: add widget");
    expect(p).toContain("Files changed:");
    expect(p).toContain("M\tsrc/x.ts");
  });

  it("uses custom instructions verbatim, still appending the context", () => {
    const p = buildPrPrompt("- fix: thing", "M\ta.ts", "WRITE LIKE A PIRATE");
    expect(p).toContain("WRITE LIKE A PIRATE");
    expect(p).not.toContain(DEFAULT_PR_INSTRUCTIONS);
    expect(p).toContain("- fix: thing");
  });

  it("falls back to the default when instructions are blank, and labels empty context", () => {
    const p = buildPrPrompt("", "", "   ");
    expect(p).toContain(DEFAULT_PR_INSTRUCTIONS);
    expect(p).toContain("(none)");
    expect(p).toContain("(none reported)");
  });

  it("truncates an enormous commit list", () => {
    const p = buildPrPrompt("x".repeat(40_000), "M\ta.ts");
    expect(p).toContain("…(commits truncated)");
  });
});

describe("splitPrMessage", () => {
  it("splits the first line as the title and the rest as the body", () => {
    const { title, body } = splitPrMessage("feat: add widget\n\n## Summary\n- adds a widget");
    expect(title).toBe("feat: add widget");
    expect(body).toBe("## Summary\n- adds a widget");
  });

  it("handles a title-only response", () => {
    expect(splitPrMessage("fix: one-liner")).toEqual({ title: "fix: one-liner", body: "" });
  });

  it("strips a wrapping code fence and a 'Title:' / heading prefix", () => {
    expect(splitPrMessage("```\nTitle: feat: x\nbody here\n```").title).toBe("feat: x");
    expect(splitPrMessage("# feat: y\nbody").title).toBe("feat: y");
  });
});
