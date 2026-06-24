import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PortInfo } from "../types.js";

const pexec = promisify(execFile);

// Split a host:port string from the right so IPv6 ("[::1]:8189"), IPv4 ("127.0.0.1:8189")
// and wildcard ("*:5173") all parse. Drops any trailing "(LISTEN)" token first.
function splitAddrPort(s: string): { address: string; port: number } | null {
  const clean = s.trim().split(/\s+/)[0] ?? "";
  const i = clean.lastIndexOf(":");
  if (i < 0) return null;
  const port = Number(clean.slice(i + 1));
  if (!Number.isInteger(port) || port <= 0) return null;
  return { address: clean.slice(0, i), port };
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -FpcPtn` field output (macOS, and the Linux fallback). */
export function parseLsof(stdout: string): PortInfo[] {
  const rows: PortInfo[] = [];
  let pid = 0, name = "", protocol = "tcp";
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const tag = line[0], val = line.slice(1);
    if (tag === "p") pid = Number(val) || 0;
    else if (tag === "c") name = val;
    else if (tag === "P") protocol = val.toLowerCase();
    else if (tag === "n") {
      const a = splitAddrPort(val);
      if (a) rows.push({ port: a.port, protocol, address: a.address, pid, name });
    }
  }
  return rows;
}

// users:(("node",pid=2842,fd=19)) — grab the first process name + pid (good enough; a
// socket shared by several pids is rare and the first owner is the one worth killing).
const SS_PROC = /users:\(\("([^"]+)",pid=(\d+)/;

/** Parse `ss -tlnp` output (Linux). Ports with no process column (unprivileged) keep pid 0. */
export function parseSs(stdout: string): PortInfo[] {
  const rows: PortInfo[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("LISTEN")) continue;
    const cols = line.trim().split(/\s+/);
    const a = splitAddrPort(cols[3] ?? ""); // State Recv-Q Send-Q [Local Address:Port] ...
    if (!a) continue;
    let pid = 0, name = "";
    const m = SS_PROC.exec(line);
    if (m) { name = m[1]; pid = Number(m[2]); }
    rows.push({ port: a.port, protocol: "tcp", address: a.address, pid, name });
  }
  return rows;
}

/** Build a pid → image-name map from `tasklist /FO CSV /NH` output (Windows). */
export function parseTasklist(csv: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of csv.split("\n")) {
    if (!line.trim()) continue;
    const cells = line.split('","').map(c => c.replace(/^"|"$/g, ""));
    const pid = Number(cells[1]);
    if (Number.isInteger(pid)) map.set(pid, cells[0]);
  }
  return map;
}

/** Parse `netstat -ano -p TCP` output (Windows), naming each pid from the tasklist map. */
export function parseNetstat(stdout: string, names: Map<number, string>): PortInfo[] {
  const rows: PortInfo[] = [];
  for (const line of stdout.split("\n")) {
    const cols = line.trim().split(/\s+/); // Proto Local Foreign State PID
    if (cols.length < 5) continue;
    if (cols[0] !== "TCP" && cols[0] !== "UDP") continue;
    if (cols[3] !== "LISTENING") continue;
    const a = splitAddrPort(cols[1]);
    if (!a) continue;
    const pid = Number(cols[4]) || 0;
    rows.push({ port: a.port, protocol: cols[0].toLowerCase(), address: a.address, pid, name: names.get(pid) ?? "" });
  }
  return rows;
}

/** Collapse IPv4/IPv6 duplicates of the same bind and sort by port, then pid, then address. */
export function dedupePorts(rows: PortInfo[]): PortInfo[] {
  const seen = new Map<string, PortInfo>();
  for (const r of rows) {
    const key = `${r.protocol}|${r.port}|${r.pid}|${r.address}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()].sort((a, b) =>
    a.port - b.port || a.pid - b.pid || a.address.localeCompare(b.address));
}

export interface PortRunners {
  lsof: () => Promise<string>;
  ss: () => Promise<string>;
  netstat: () => Promise<string>;
  tasklist: () => Promise<string>;
}

const MAX = 8 * 1024 * 1024;
const realRunners: PortRunners = {
  // lsof exits 1 when nothing matches (or on benign warnings) yet still prints usable
  // stdout — keep whatever it wrote instead of throwing the whole scan away.
  lsof: async () => {
    try { return (await pexec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-FpcPtn"], { maxBuffer: MAX })).stdout; }
    catch (e: any) { return e?.stdout ?? ""; }
  },
  ss: async () => (await pexec("ss", ["-tlnp"], { maxBuffer: MAX })).stdout,
  netstat: async () => (await pexec("netstat", ["-ano", "-p", "TCP"], { maxBuffer: MAX })).stdout,
  tasklist: async () => (await pexec("tasklist", ["/FO", "CSV", "/NH"], { maxBuffer: MAX })).stdout,
};

/**
 * List TCP sockets in the LISTEN state across macOS, Linux and Windows. `platform`/`runners`
 * are injectable for tests; production calls with no args use the host platform + real CLIs.
 */
export async function listListeningPorts(
  platform: NodeJS.Platform = process.platform,
  runners: Partial<PortRunners> = {},
): Promise<PortInfo[]> {
  const run = { ...realRunners, ...runners };
  let rows: PortInfo[];
  if (platform === "win32") {
    const [netstat, tasklist] = await Promise.all([run.netstat(), run.tasklist().catch(() => "")]);
    rows = parseNetstat(netstat, parseTasklist(tasklist));
  } else if (platform === "linux") {
    try { rows = parseSs(await run.ss()); }
    catch { rows = parseLsof(await run.lsof()); } // ss missing on minimal images → lsof
  } else {
    rows = parseLsof(await run.lsof());
  }
  return dedupePorts(rows);
}
