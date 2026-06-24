import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFiles } from "./search.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tr-listfiles-"));
  mkdirSync(join(root, "src", "app", "onboarding"), { recursive: true });
  writeFileSync(join(root, "src", "app", "onboarding", "PhaseStepper.tsx"), "x");
  writeFileSync(join(root, "src", "app", "page.tsx"), "x");
  writeFileSync(join(root, "readme.md"), "x");
  // these whole subtrees must be pruned from the index
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pkg", "index.js"), "x");
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "config"), "x");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("listFiles", () => {
  it("lists files recursively as absolute paths, pruning build + system folders", async () => {
    const { files, truncated } = await listFiles(root);
    const rel = files.map((f) => f.slice(root.length + 1)).sort();
    expect(rel).toEqual(["readme.md", "src/app/onboarding/PhaseStepper.tsx", "src/app/page.tsx"]);
    expect(files.every((f) => f.startsWith(root + "/"))).toBe(true);
    expect(truncated).toBe(false);
  });
});
