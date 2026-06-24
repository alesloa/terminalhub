import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchFile, type FileChange } from "./watchFile.js";

const OPTS = { debounceMs: 10, pollMs: 25 };

async function waitFor(pred: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("watchFile", () => {
  it("emits on content change but not for the initial state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-watch-"));
    const file = join(dir, "note.txt");
    writeFileSync(file, "one");

    const changes: FileChange[] = [];
    const stop = watchFile(file, (c) => changes.push(c), OPTS);
    try {
      // Priming the watcher must NOT report the file as a change.
      await sleep(80);
      expect(changes).toHaveLength(0);

      writeFileSync(file, "one-two-three");
      await waitFor(() => changes.length >= 1);
      expect(changes[0].exists).toBe(true);
      expect(changes[0].size).toBe("one-two-three".length);
    } finally {
      stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a deletion as exists:false, then stops after stop()", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tr-watch-"));
    const file = join(dir, "doomed.txt");
    writeFileSync(file, "alive");

    const changes: FileChange[] = [];
    const stop = watchFile(file, (c) => changes.push(c), OPTS);
    try {
      await sleep(60); // let it prime
      unlinkSync(file);
      await waitFor(() => changes.some((c) => !c.exists));

      const countAtStop = changes.length;
      stop();
      writeFileSync(file, "back from the dead");
      await sleep(120);
      expect(changes.length).toBe(countAtStop); // no callbacks after stop()
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
