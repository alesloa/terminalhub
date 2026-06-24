import si from "systeminformation";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import type { SystemStats } from "../types.js";

export type { SystemStats };

const pexec = promisify(execFile);

/**
 * Minimal injectable surface of `systeminformation` so tests pass a fake (mirrors the
 * runner injection in ports.ts / processes.ts). The real lib's return types are wider —
 * structurally assignable to these.
 */
export interface Si {
  currentLoad(): Promise<{ currentLoad: number }>;
  mem(): Promise<{ total: number; active: number; available: number }>;
  networkStats(iface?: string): Promise<Array<{ rx_sec: number; tx_sec: number }>>;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
// Drop NaN / negatives to a clean 0.
const atLeast0 = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

// ─── Windows: WMI-free implementations ───────────────────────────────────────
// systeminformation uses Get-CimInstance Win32_Processor (CPU), Win32_OperatingSystem (mem),
// and Win32_PerfRawData_Tcpip_NetworkInterface (net) on Windows — polled every 2s this
// keeps WmiPrvSE.exe pegged at ~48% CPU and makes the gauge report ~12% while Task Manager
// shows 56% (WmiPrvSE's own load isn't reflected in WMI's own answer).
//
// All three replaced with WMI-free alternatives that read the same kernel counters Task Manager
// uses. systeminformation is still used on Linux/macOS where it's backed by /proc and sysctl.

// CPU — os.cpus() time deltas (same counters as Task Manager, no subprocess at all)
let _prevCpuSample: { idle: number; total: number } | null = null;

function snapCpuTimes(): { idle: number; total: number } {
  let idle = 0, total = 0;
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

async function cpuLoadNative(): Promise<{ currentLoad: number }> {
  const prev = _prevCpuSample ?? snapCpuTimes();
  if (!_prevCpuSample) {
    // First ever call: wait 200ms for a meaningful delta then re-sample.
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  const curr = snapCpuTimes();
  _prevCpuSample = curr;
  const idleDelta = curr.idle - prev.idle;
  const totalDelta = curr.total - prev.total;
  return { currentLoad: totalDelta > 0 ? clamp(100 - (idleDelta / totalDelta) * 100, 0, 100) : 0 };
}

// Memory — os.totalmem / os.freemem (kernel calls, no subprocess, no WMI)
function memNative(): Promise<{ total: number; active: number; available: number }> {
  const total = os.totalmem();
  const available = os.freemem();
  return Promise.resolve({ total, active: total - available, available });
}

// Memory on macOS — match Activity Monitor's "Memory Used" (App + Wired + Compressed). The
// systeminformation darwin path reports only `Pages active` as its "active" figure, which omits
// wired and compressed memory — so the gauge showed ~12 GB while Activity Monitor showed ~57 GB.
// vm_stat exposes the same page counts Activity Monitor uses: App Memory = Anonymous − Purgeable,
// plus Wired, plus the compressor's occupied pages.
/** Parse `vm_stat` stdout into macOS "Memory Used" bytes (App + Wired + Compressed). null = unparseable. */
export function parseDarwinMemUsed(stdout: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(stdout)?.[1]);
  if (!pageSize) return null;
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)\\.`).exec(stdout)?.[1] ?? 0);
  const anonymous = pages("Anonymous pages");
  const wired = pages("Pages wired down");
  const compressed = pages("Pages occupied by compressor");
  if (!anonymous && !wired && !compressed) return null; // not a vm_stat we understand
  const appMem = Math.max(0, anonymous - pages("Pages purgeable"));
  return (appMem + wired + compressed) * pageSize;
}

async function memDarwin(): Promise<{ total: number; active: number; available: number }> {
  const total = os.totalmem();
  try {
    const { stdout } = await pexec("vm_stat", [], { maxBuffer: 64 * 1024 });
    const used = parseDarwinMemUsed(stdout);
    if (used !== null) {
      const u = Math.min(used, total);
      return { total, active: u, available: Math.max(0, total - u) };
    }
  } catch {
    // fall through to the free-count fallback below
  }
  // vm_stat unavailable/unreadable — kernel free count (counts cache as used, but never reports 0).
  const available = os.freemem();
  return { total, active: total - available, available };
}

// Network — netstat -e (Windows built-in, reads kernel counters directly, zero WMI).
// Returns cumulative bytes received/sent since boot; we diff between calls for bytes/sec.
// Get-NetAdapterStatistics was replaced because it goes through the NetAdapterCim WMI
// provider (wmiprvse.exe hosts NetAdapterCim.dll), so it also spikes WmiPrvSE.
let _prevNetSample: { at: number; rx: number; tx: number } | null = null;

async function networkStatsNative(): Promise<Array<{ rx_sec: number; tx_sec: number }>> {
  try {
    const { stdout } = await pexec("netstat", ["-e"], { maxBuffer: 16 * 1024 });
    // "Bytes    1234567890    987654321"  (columns: Received, Sent)
    const m = /^\s*Bytes\s+([\d,]+)\s+([\d,]+)/im.exec(stdout);
    if (!m) return [{ rx_sec: 0, tx_sec: 0 }];

    const rx = Number(m[1].replace(/,/g, ""));
    const tx = Number(m[2].replace(/,/g, ""));
    const now = Date.now();

    let rxSec = 0, txSec = 0;
    if (_prevNetSample && now > _prevNetSample.at) {
      const elapsed = (now - _prevNetSample.at) / 1000;
      rxSec = Math.max(0, (rx - _prevNetSample.rx) / elapsed);
      txSec = Math.max(0, (tx - _prevNetSample.tx) / elapsed);
    }
    _prevNetSample = { at: now, rx, tx };
    return [{ rx_sec: rxSec, tx_sec: txSec }];
  } catch {
    return [{ rx_sec: 0, tx_sec: 0 }];
  }
}

// The network read is the ONLY non-trivial cost in a stats snapshot: a `netstat -e` subprocess on
// Windows, a /proc/sysctl walk via systeminformation elsewhere. CPU (os.cpus deltas) and mem
// (os.totalmem/freemem) are free kernel calls. So cache JUST the network sample: the ~2s gauge poll
// keeps CPU/mem live every tick while netstat fires at most every `ttlMs`, and concurrent callers
// (multiple tabs/devices) share one in-flight read instead of each spawning their own subprocess.
type NetSample = Array<{ rx_sec: number; tx_sec: number }>;
function cacheNetwork(fn: () => Promise<NetSample>, ttlMs = 3000): () => Promise<NetSample> {
  let cache: { val: NetSample; at: number } | null = null;
  let pending: Promise<NetSample> | null = null;
  return async () => {
    const now = Date.now();
    if (cache && now - cache.at < ttlMs) return cache.val;
    if (pending) return pending; // a read is already in flight — coalesce onto it
    pending = (async () => {
      try {
        const val = await fn();
        cache = { val, at: Date.now() };
        return val;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}

// On Windows: use all-native implementations — zero WMI.
// On macOS: native vm_stat memory (systeminformation's `active` omits wired+compressed); CPU/net
// stay on systeminformation (sysctl-backed, no WMI). On Linux: systeminformation throughout.
const defaultSi: Si =
  process.platform === "win32"
    ? { currentLoad: cpuLoadNative, mem: memNative, networkStats: cacheNetwork(networkStatsNative) }
    : {
        currentLoad: () => si.currentLoad(),
        mem: process.platform === "darwin" ? memDarwin : () => si.mem(),
        networkStats: cacheNetwork(() => si.networkStats()),
      };

/** Read one CPU/RAM/network snapshot. `si` is injectable for tests. */
export async function readSystemStats(s: Si = defaultSi): Promise<SystemStats> {
  const [load, mem, net] = await Promise.all([s.currentLoad(), s.mem(), s.networkStats()]);
  const total = atLeast0(mem.total);
  const used = total > 0 ? Math.min(atLeast0(mem.active), total) : atLeast0(mem.active);
  const iface = net[0];
  return {
    cpu: { percent: clamp(load.currentLoad, 0, 100) },
    mem: { used, total, percent: total > 0 ? clamp((used / total) * 100, 0, 100) : 0 },
    net: {
      rxBytesPerSec: atLeast0(iface?.rx_sec ?? 0),
      txBytesPerSec: atLeast0(iface?.tx_sec ?? 0),
    },
  };
}
