import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotenv } from "./env.js";

const TMP = join(tmpdir(), `terminalhub-env-${process.pid}.env`);
const KEYS = ["TR_TEST_A", "TR_TEST_B", "TR_TEST_QUOTED", "TR_TEST_EXISTING"];

afterEach(() => {
  try { rmSync(TMP); } catch { /* ignore */ }
  for (const k of KEYS) delete process.env[k];
});

describe("loadDotenv", () => {
  it("loads KEY=VALUE pairs, skipping comments and blank lines", () => {
    writeFileSync(TMP, "# a comment\n\nTR_TEST_A=hello\nTR_TEST_B = world \n");
    loadDotenv(TMP);
    expect(process.env.TR_TEST_A).toBe("hello");
    expect(process.env.TR_TEST_B).toBe("world");
  });

  it("strips surrounding quotes", () => {
    writeFileSync(TMP, `TR_TEST_QUOTED="a b c"\n`);
    loadDotenv(TMP);
    expect(process.env.TR_TEST_QUOTED).toBe("a b c");
  });

  it("does not override variables already set in the environment", () => {
    process.env.TR_TEST_EXISTING = "from-shell";
    writeFileSync(TMP, "TR_TEST_EXISTING=from-file\n");
    loadDotenv(TMP);
    expect(process.env.TR_TEST_EXISTING).toBe("from-shell");
  });

  it("is a no-op when the file is missing", () => {
    expect(() => loadDotenv(join(tmpdir(), "terminalhub-does-not-exist-xyz.env"))).not.toThrow();
  });
});
