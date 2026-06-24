import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectSessionForPid, readClaudePidMap } from "./terminalDetect.js";
import { claudeSessionsDir } from "./paths.js";

let home: string;
let realHome: string | undefined;

beforeEach(() => {
  realHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "tr-termdetect-"));
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

function writePidFile(name: string, entry: Record<string, unknown>): void {
  const dir = claudeSessionsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), JSON.stringify(entry));
}

// Fake `ps -axo pid=,ppid=,pcpu=,pmem=,rss=,args=` output for an injected tree.
// shell(1000) -> claude(1001). An unrelated claude(2001) hangs off a different shell(2000).
function fakePs(): Promise<string> {
  return Promise.resolve(
    [
      "  1     0   0.0  0.0  1000 /sbin/launchd",
      "1000     1   0.0  0.0  1000 -zsh",
      "1001  1000   1.0  0.5 50000 node /usr/bin/claude",
      "2000     1   0.0  0.0  1000 -zsh",
      "2001  2000   1.0  0.5 50000 node /usr/bin/claude",
    ].join("\n"),
  );
}

describe("readClaudePidMap", () => {
  it("reads pid -> sessionId from every *.json PID file, skipping malformed ones", async () => {
    writePidFile("a.json", { pid: 1001, sessionId: "sess-A", cwd: "/w" });
    writePidFile("b.json", { pid: 2001, sessionId: "sess-B", cwd: "/w" });
    writePidFile("bad.json", { nope: true });
    writeFileSync(path.join(claudeSessionsDir(), "ignore.txt"), "not json");

    const map = await readClaudePidMap();
    expect(map.get(1001)).toBe("sess-A");
    expect(map.get(2001)).toBe("sess-B");
    expect(map.size).toBe(2);
  });

  it("returns an empty map when the sessions dir is absent", async () => {
    expect((await readClaudePidMap()).size).toBe(0);
  });
});

describe("detectSessionForPid", () => {
  it("returns the sessionId whose claude pid descends from the given shell pid", async () => {
    writePidFile("a.json", { pid: 1001, sessionId: "sess-A" });
    writePidFile("b.json", { pid: 2001, sessionId: "sess-B" });
    expect(await detectSessionForPid(1000, fakePs)).toBe("sess-A");
    expect(await detectSessionForPid(2000, fakePs)).toBe("sess-B");
  });

  it("returns undefined when no tracked claude pid descends from the shell", async () => {
    writePidFile("a.json", { pid: 1001, sessionId: "sess-A" });
    expect(await detectSessionForPid(9999, fakePs)).toBeUndefined();
  });

  it("returns undefined for an empty shell pid", async () => {
    writePidFile("a.json", { pid: 1001, sessionId: "sess-A" });
    expect(await detectSessionForPid(undefined, fakePs)).toBeUndefined();
  });

  it("returns undefined when there are no PID files", async () => {
    expect(await detectSessionForPid(1000, fakePs)).toBeUndefined();
  });
});
