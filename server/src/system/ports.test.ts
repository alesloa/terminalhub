import { describe, it, expect } from "vitest";
import { parseLsof, parseSs, parseNetstat, parseTasklist, dedupePorts, listListeningPorts } from "./ports.js";

// Real-shape `lsof -nP -iTCP -sTCP:LISTEN -FpcPtn` field output (macOS).
const LSOF = [
  "p687", "crapportd", "f10", "tIPv4", "PTCP", "n*:49188", "f11", "tIPv6", "PTCP", "n*:49188",
  "p2842", "cnode", "f19", "tIPv4", "PTCP", "n127.0.0.1:8189", "f20", "tIPv6", "PTCP", "n[::1]:8189",
  "",
].join("\n");

// Real-shape `ss -tlnp` output (Linux). Last row has no process column (unprivileged).
const SS = [
  "State    Recv-Q   Send-Q     Local Address:Port      Peer Address:Port    Process",
  'LISTEN   0        128        127.0.0.1:8189          0.0.0.0:*            users:(("node",pid=2842,fd=19))',
  'LISTEN   0        128        [::1]:8189              [::]:*              users:(("node",pid=2842,fd=20))',
  'LISTEN   0        511        *:5173                  *:*                 users:(("vite",pid=3001,fd=24))',
  "LISTEN   0        4096       0.0.0.0:22              0.0.0.0:*           ",
  "",
].join("\n");

// Real-shape `netstat -ano -p TCP` output (Windows).
const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:8189           0.0.0.0:0              LISTENING       2842",
  "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       3001",
  "  TCP    [::]:8189              [::]:0                 LISTENING       2842",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       912",
  "  TCP    127.0.0.1:55012        93.184.216.34:443     ESTABLISHED     7777",
  "",
].join("\n");

// `tasklist /FO CSV /NH` output (Windows).
const TASKLIST = [
  '"node.exe","2842","Console","1","120,000 K"',
  '"node.exe","3001","Console","1","98,000 K"',
  '"svchost.exe","912","Services","0","12,000 K"',
  "",
].join("\n");

describe("parseLsof", () => {
  it("parses one row per listening socket with addr/port/pid/name", () => {
    const rows = parseLsof(LSOF);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ port: 49188, protocol: "tcp", address: "*", pid: 687, name: "rapportd" });
    expect(rows[2]).toEqual({ port: 8189, protocol: "tcp", address: "127.0.0.1", pid: 2842, name: "node" });
    expect(rows[3]).toEqual({ port: 8189, protocol: "tcp", address: "[::1]", pid: 2842, name: "node" });
  });
});

describe("parseSs", () => {
  it("parses LISTEN rows and extracts process name + pid", () => {
    const rows = parseSs(SS);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({ port: 8189, protocol: "tcp", address: "127.0.0.1", pid: 2842, name: "node" });
    expect(rows[2]).toEqual({ port: 5173, protocol: "tcp", address: "*", pid: 3001, name: "vite" });
  });

  it("keeps a port even when the process column is missing (unprivileged ss)", () => {
    const last = parseSs(SS)[3];
    expect(last).toEqual({ port: 22, protocol: "tcp", address: "0.0.0.0", pid: 0, name: "" });
  });
});

describe("parseTasklist + parseNetstat", () => {
  it("maps pid → image name from tasklist CSV", () => {
    const map = parseTasklist(TASKLIST);
    expect(map.get(2842)).toBe("node.exe");
    expect(map.get(912)).toBe("svchost.exe");
  });

  it("parses only LISTENING rows and enriches the name from the pid map", () => {
    const rows = parseNetstat(NETSTAT, parseTasklist(TASKLIST));
    expect(rows).toHaveLength(4); // ESTABLISHED row excluded
    expect(rows[0]).toEqual({ port: 8189, protocol: "tcp", address: "0.0.0.0", pid: 2842, name: "node.exe" });
    expect(rows[2]).toEqual({ port: 8189, protocol: "tcp", address: "[::]", pid: 2842, name: "node.exe" });
  });
});

describe("dedupePorts", () => {
  it("collapses IPv4/IPv6 duplicates of the same port+pid+address and sorts by port", () => {
    const rows = dedupePorts(parseLsof(LSOF));
    expect(rows).toHaveLength(3); // crapportd's two *:49188 collapse to one
    expect(rows.map(r => r.port)).toEqual([8189, 8189, 49188]);
    expect(rows[2]).toEqual({ port: 49188, protocol: "tcp", address: "*", pid: 687, name: "rapportd" });
  });
});

describe("listListeningPorts", () => {
  it("uses lsof on darwin", async () => {
    const ports = await listListeningPorts("darwin", { lsof: async () => LSOF });
    expect(ports.map(p => p.port)).toEqual([8189, 8189, 49188]);
  });

  it("uses ss on linux", async () => {
    const ports = await listListeningPorts("linux", { ss: async () => SS });
    expect(ports.map(p => p.port)).toEqual([22, 5173, 8189, 8189]);
  });

  it("falls back to lsof on linux when ss is unavailable", async () => {
    const ports = await listListeningPorts("linux", {
      ss: async () => { throw Object.assign(new Error("not found"), { code: "ENOENT" }); },
      lsof: async () => LSOF,
    });
    expect(ports.map(p => p.port)).toEqual([8189, 8189, 49188]);
  });

  it("uses netstat + tasklist on win32", async () => {
    const ports = await listListeningPorts("win32", { netstat: async () => NETSTAT, tasklist: async () => TASKLIST });
    expect(ports.map(p => p.port)).toEqual([135, 5173, 8189, 8189]);
    expect(ports[2].name).toBe("node.exe");
  });
});
