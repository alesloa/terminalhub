import { describe, it, expect } from "vitest";
import { parsePs } from "./processes.js";

// Real-shape sample from `ps -axo pid=,ppid=,pcpu=,pmem=,rss=,args=` (macOS/Linux).
const SAMPLE = [
  "    1     0   0.1  0.0  22256 /sbin/launchd",
  "  337     1   0.8  0.1  62496 /usr/libexec/logd",
  "  900   337  12.5  2.3 512000 /usr/bin/node /Volumes/Code/app/server.js --port 8189",
  "",
].join("\n");

describe("parsePs", () => {
  it("parses numeric columns and keeps the full command", () => {
    const rows = parsePs(SAMPLE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ pid: 1, ppid: 0, cpu: 0.1, mem: 0.0, rss: 22256, name: "launchd", command: "/sbin/launchd" });
  });

  it("derives name from the executable basename while command keeps its args", () => {
    const node = parsePs(SAMPLE)[2];
    expect(node.name).toBe("node");
    expect(node.command).toBe("/usr/bin/node /Volumes/Code/app/server.js --port 8189");
    expect(node.cpu).toBe(12.5);
    expect(node.rss).toBe(512000);
  });

  it("ignores blank and non-matching lines", () => {
    expect(parsePs("\n   \ngarbage with no leading numbers\n")).toEqual([]);
  });
});
