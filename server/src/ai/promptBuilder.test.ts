import { describe, it, expect } from "vitest";
import {
  buildPrompterPrompt, PROMPT_BUILDER_INSTRUCTIONS,
  buildBlueprintPrompterPrompt, BLUEPRINT_INSTRUCTIONS,
} from "./promptBuilder.js";

describe("buildPrompterPrompt", () => {
  it("includes the instructions, target tool, and task", () => {
    const p = buildPrompterPrompt({ idea: "summarize a PDF into 5 bullets", targetTool: "Claude" });
    expect(p).toContain(PROMPT_BUILDER_INSTRUCTIONS);
    expect(p).toContain("Target tool: Claude");
    expect(p).toContain("Task: summarize a PDF into 5 bullets");
  });

  it("appends optional dimensions only when provided", () => {
    const p = buildPrompterPrompt({ idea: "x", targetTool: "GPT-4o", outputFormat: "5 bullets", audience: "execs" });
    expect(p).toContain("Output format: 5 bullets");
    expect(p).toContain("Audience: execs");
    expect(p).not.toContain("Constraints:");
  });

  it("trims whitespace-only optional fields out", () => {
    const p = buildPrompterPrompt({ idea: "x", targetTool: "Cursor", constraints: "   " });
    expect(p).not.toContain("Constraints:");
  });
});

describe("buildBlueprintPrompterPrompt", () => {
  const spec = "1. Create a file\n2. Check: empty?\n   - If yes: 3. Write\n   - If no: 4. Skip";

  it("includes the blueprint instructions, target tool, and the spec verbatim", () => {
    const p = buildBlueprintPrompterPrompt(spec, "Claude Code");
    expect(p).toContain(BLUEPRINT_INSTRUCTIONS);
    expect(p).toContain("Target tool: Claude Code");
    expect(p).toContain("Blueprint:");
    expect(p).toContain(spec);
  });

  it("truncates an over-long spec", () => {
    const huge = "x".repeat(20_000);
    const p = buildBlueprintPrompterPrompt(huge, "Codex");
    expect(p).toContain("…(truncated)");
    expect(p.length).toBeLessThan(huge.length);
  });
});
