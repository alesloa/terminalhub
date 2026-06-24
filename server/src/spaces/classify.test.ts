import { describe, it, expect } from "vitest";
import { classify } from "./classify.js";

describe("classify", () => {
  it("buckets design-ish items into Design", () => {
    expect(classify("design-taste-frontend", "Frontend design taste.")).toBe("Design");
    expect(classify("gsap", "Animation library helper.")).toBe("Design");
    expect(classify("pencil", "npx pencil-mcp")).toBe("Design");
  });

  it("buckets writing/prose items into Writing", () => {
    expect(classify("humanizer", "Strip AI tells from prose.")).toBe("Writing");
    expect(classify("prd-creator", "Create a PRD.")).toBe("Writing");
  });

  it("buckets git/version items into Git", () => {
    expect(classify("commit", "Stage and create a git commit.")).toBe("Git");
    expect(classify("pr-workflow", "Pull request workflow.")).toBe("Git");
  });

  it("buckets media items into Media", () => {
    expect(classify("describe-image", "Describe an image.")).toBe("Media");
    expect(classify("remotion-best-practices", "Remotion video tips.")).toBe("Media");
  });

  it("buckets agent/model items into AI", () => {
    expect(classify("llm-council", "A council of LLMs.")).toBe("AI");
    expect(classify("prompt-master", "Prompt engineering.")).toBe("AI");
  });

  it("buckets code/dev items into Code", () => {
    expect(classify("skill-creator", "Create a new skill.")).toBe("Code");
    expect(classify("codegraph", "code intelligence graph")).toBe("Code");
  });

  it("falls back to Other when nothing matches", () => {
    expect(classify("banana", null)).toBe("Other");
    expect(classify("asana-alex", "asana mcp")).toBe("Other");
  });

  it("lets a frontmatter category override the keyword guess (title-cased)", () => {
    // meeting-notes would key-match Writing, but its own frontmatter wins.
    expect(classify("meeting-notes", "Take meeting notes.", "productivity")).toBe("Productivity");
  });

  it("ignores an empty/whitespace frontmatter category and uses the guess", () => {
    expect(classify("commit", "git commit", "  ")).toBe("Git");
  });
});
