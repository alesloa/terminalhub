import { describe, it, expect } from "vitest";
import { readSystemStats, parseDarwinMemUsed, type Si } from "./stats.js";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const KB = 1024;

// Build a fake `systeminformation` surface with overridable values. Defaults mirror the
// reference screenshot (CPU ~36%, 41.71/64 GB RAM, ↓6.4 MB/s rx, ↑136 KB/s tx).
function fakeSi(over: Partial<{ load: number; total: number; active: number; available: number; rx: number; tx: number; net: Array<{ rx_sec: number; tx_sec: number }> }> = {}): Si {
  const v = { load: 36.4, total: 64 * GB, active: 41.71 * GB, available: 22 * GB, rx: 6.4 * MB, tx: 136 * KB, ...over };
  return {
    currentLoad: async () => ({ currentLoad: v.load }),
    mem: async () => ({ total: v.total, active: v.active, available: v.available }),
    networkStats: async () => over.net ?? [{ rx_sec: v.rx, tx_sec: v.tx }],
  };
}

describe("readSystemStats", () => {
  it("maps systeminformation output into SystemStats", async () => {
    const s = await readSystemStats(fakeSi());
    expect(s.cpu.percent).toBeCloseTo(36.4);
    expect(s.mem.total).toBe(64 * GB);
    expect(s.mem.used).toBe(41.71 * GB);
    expect(s.mem.percent).toBeCloseTo((41.71 / 64) * 100); // ≈ 65%
    expect(s.net.rxBytesPerSec).toBe(6.4 * MB);
    expect(s.net.txBytesPerSec).toBe(136 * KB);
  });

  it("clamps a first-sample -1 network rate to 0", async () => {
    const s = await readSystemStats(fakeSi({ rx: -1, tx: -1 }));
    expect(s.net.rxBytesPerSec).toBe(0);
    expect(s.net.txBytesPerSec).toBe(0);
  });

  it("treats an empty networkStats array (no interface) as 0", async () => {
    const s = await readSystemStats(fakeSi({ net: [] }));
    expect(s.net.rxBytesPerSec).toBe(0);
    expect(s.net.txBytesPerSec).toBe(0);
  });

  it("clamps cpu percent into 0..100", async () => {
    expect((await readSystemStats(fakeSi({ load: 142 }))).cpu.percent).toBe(100);
    expect((await readSystemStats(fakeSi({ load: -3 }))).cpu.percent).toBe(0);
  });

  it("guards against a zero total (no NaN / div-by-zero)", async () => {
    const s = await readSystemStats(fakeSi({ total: 0, active: 0 }));
    expect(s.mem.percent).toBe(0);
    expect(s.mem.used).toBe(0);
    expect(s.mem.total).toBe(0);
  });
});

describe("parseDarwinMemUsed", () => {
  // App Memory (Anonymous − Purgeable) + Wired + Compressed — the same sum Activity Monitor shows
  // as "Memory Used". `Pages active`, free, inactive, file-backed etc. are deliberately ignored.
  const VM_STAT = [
    "Mach Virtual Memory Statistics: (page size of 4096 bytes)",
    "Pages free:                          200000.",
    "Pages active:                        700000.",
    "Pages inactive:                      300000.",
    "Pages speculative:                    50000.",
    "Pages throttled:                          0.",
    "Pages wired down:                    500000.",
    "Pages purgeable:                     100000.",
    "File-backed pages:                   400000.",
    "Anonymous pages:                    1000000.",
    "Pages stored in compressor:         5000000.",
    "Pages occupied by compressor:       2000000.",
    "Swapins:                                  0.",
    "Swapouts:                                 0.",
  ].join("\n");

  it("sums App + Wired + Compressed × page size (ignoring active/cache)", () => {
    // (1000000 − 100000) + 500000 + 2000000 = 3,400,000 pages × 4096
    expect(parseDarwinMemUsed(VM_STAT)).toBe(3_400_000 * 4096);
  });

  it("does not pick up 'Pages stored in compressor' for the occupied count", () => {
    // 2,000,000 (occupied), NOT 5,000,000 (stored) — the labels share a prefix.
    const compressedBytes = 2_000_000 * 4096;
    const appAndWired = (1_000_000 - 100_000 + 500_000) * 4096;
    expect(parseDarwinMemUsed(VM_STAT)).toBe(appAndWired + compressedBytes);
  });

  it("returns null when the output isn't recognizable vm_stat", () => {
    expect(parseDarwinMemUsed("not vm_stat output")).toBeNull();
    expect(parseDarwinMemUsed("page size of 4096 bytes\nPages free: 100.")).toBeNull();
  });
});
