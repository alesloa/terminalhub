import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import os from "node:os";
import type { ProcessInfo } from "../types.js";

const pexec = promisify(execFile);

/** Runner abstraction so tests can inject a fake. Returns ps stdout. */
export type PsRunner = () => Promise<string>;

// pid ppid %cpu %mem rss(KB) full-command. Trailing `=` on each keyword suppresses
// the header row. This keyword set is portable across macOS (BSD ps) and Linux (procps).
const PS_ARGS = ["-axo", "pid=,ppid=,pcpu=,pmem=,rss=,args="];

export const realPsRunner: PsRunner = async () => {
  const { stdout } = await pexec("ps", PS_ARGS, { maxBuffer: 8 * 1024 * 1024 });
  return stdout;
};

/** Windows alternative: use Get-Process (Win32 API directly, no WMI — WMI caused WmiPrvSE.exe
 *  to peg at ~48% CPU when the process monitor's 2s poll triggered Get-CimInstance Win32_Process).
 *  CPU% is computed from the delta of TotalProcessorTime between calls.
 *  Results are cached 3 s; concurrent in-flight calls share one promise (no stampede). */
let _winProcCache: { procs: ProcessInfo[]; at: number } | null = null;
let _winProcPending: Promise<ProcessInfo[]> | null = null;
// Previous sample of per-PID accumulated CPU seconds, used to derive %.
let _winCpuPrev: { at: number; byPid: Map<number, number> } | null = null;

async function listProcessesWindows(): Promise<ProcessInfo[]> {
  const now = Date.now();
  if (_winProcCache && now - _winProcCache.at < 3000) return _winProcCache.procs;
  if (_winProcPending) return _winProcPending;
  _winProcPending = (async () => {
    try {
      // Get-Process reads from Win32 process APIs (no WMI). CPU = total processor seconds.
      // `($_.CPU + 0)` safely coerces null (inaccessible system procs) to 0 in PS5.1.
      const { stdout } = await pexec("powershell", [
        "-NoProfile", "-NonInteractive", "-Command",
        "Get-Process -ErrorAction SilentlyContinue | ForEach-Object { ($_.Id,$_.Name,($_.CPU+0),$_.WorkingSet64 -join \"`t\") }",
      ], { maxBuffer: 8 * 1024 * 1024 });

      const totalMem = os.totalmem() || 1;
      const cores = os.cpus().length || 1;
      const nowSample = Date.now();
      const elapsed = _winCpuPrev ? (nowSample - _winCpuPrev.at) / 1000 : 0;

      const rows: ProcessInfo[] = [];
      const newByPid = new Map<number, number>();
      for (const line of stdout.split(/\r?\n/)) {
        const parts = line.trim().split("\t");
        if (parts.length < 2) continue;
        const pid = Number(parts[0]);
        const name = (parts[1] ?? "").trim().replace(/\.exe$/i, "");
        const cpuSecs = Number(parts[2] ?? 0) || 0;
        const wsBytes = Number(parts[3] ?? 0) || 0;
        if (!Number.isFinite(pid) || pid <= 0) continue;
        newByPid.set(pid, cpuSecs);

        // CPU%: delta of accumulated CPU seconds divided by wall-clock seconds × cores, clamped 0–100.
        let cpu = 0;
        if (_winCpuPrev && elapsed > 0) {
          const prev = _winCpuPrev.byPid.get(pid) ?? cpuSecs;
          cpu = Math.min(100, Math.max(0, ((cpuSecs - prev) / elapsed / cores) * 100));
        }
        const rss = Math.round(wsBytes / 1024); // bytes → KB
        const mem = (wsBytes / totalMem) * 100;
        rows.push({ pid, ppid: 0, cpu, mem, rss, name, command: name });
      }

      _winCpuPrev = { at: nowSample, byPid: newByPid };
      _winProcCache = { procs: rows, at: nowSample };
      return rows;
    } finally {
      _winProcPending = null;
    }
  })();
  return _winProcPending;
}

// First 5 fields are numeric (no spaces); the rest is the full command line, which
// may contain spaces — so capture it greedily as a single trailing field.
const LINE = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+?)\s*$/;

/** Parse `ps -axo pid=,ppid=,pcpu=,pmem=,rss=,args=` output into structured rows. */
export function parsePs(stdout: string): ProcessInfo[] {
  const rows: ProcessInfo[] = [];
  for (const line of stdout.split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const command = m[6];
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      mem: Number(m[4]),
      rss: Number(m[5]), // KB
      name: procName(command),
      command,
    });
  }
  return rows;
}

// Display name = basename of the executable (first whitespace-delimited token).
// Linux kernel threads like "[kthreadd]" have no path and pass through unchanged.
function procName(command: string): string {
  const first = command.split(/\s+/)[0] ?? command;
  return basename(first) || first;
}

export async function listProcesses(run?: PsRunner): Promise<ProcessInfo[]> {
  // On Windows, use Get-Process (no WMI) when no test-injected runner is provided.
  if (process.platform === "win32" && !run) return listProcessesWindows();
  const rows = parsePs(await (run ?? realPsRunner)());
  // `ps` reports %cpu per logical core, so a process spanning N cores reads up to N×100% — the
  // "293%" that makes no sense at a glance. Divide by the logical-core count ps counts against to
  // get a share of total machine capacity (0–100), matching the system-stats CPU gauge. Clamp the
  // tail off ps's decaying average so it can never edge past 100.
  const cores = os.cpus().length || 1;
  return rows.map((p) => ({ ...p, cpu: Math.min(100, p.cpu / cores) }));
}

export type KillSignal = "TERM" | "KILL";

/** Send a signal to a pid. Throws ESRCH if it's gone, EPERM if not permitted. */
export function killProcess(pid: number, signal: KillSignal = "TERM"): void {
  process.kill(pid, `SIG${signal}`);
}
