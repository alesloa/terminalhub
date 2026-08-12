import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexAppServerError, startCodexAppServer, type CodexAppServer } from "./appServer.js";

// The transport is exercised against a stand-in `codex` binary rather than the real CLI: these tests
// are about framing, request/response pairing and shutdown, all of which must hold whether or not
// Codex is installed on the machine running them.

/** A fake `codex` that speaks the same newline-delimited JSON and nothing else. */
const FAKE_CODEX = `#!/usr/bin/env node
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\\n");
if (process.argv[2] !== "app-server") { process.stderr.write("bad argv\\n"); process.exit(2); }
process.stderr.write("warming up\\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    switch (msg.method) {
      case "echo":
        send({ id: msg.id, result: { got: msg.params ?? null, argv: process.argv.slice(2) } });
        break;
      case "boom":
        send({ id: msg.id, error: { code: -7, message: "nope", data: { why: "test" } } });
        break;
      case "noise":
        process.stdout.write("not json at all\\n");
        process.stdout.write("\\n");
        send({ id: msg.id, result: "survived" });
        break;
      case "split":
        // One value delivered across two writes — the reader must not act on half a line.
        process.stdout.write(JSON.stringify({ id: msg.id, result: "whole" }).slice(0, 6));
        setTimeout(() => process.stdout.write(JSON.stringify({ id: msg.id, result: "whole" }).slice(6) + "\\n"), 10);
        break;
      case "notify":
        send({ method: "thread/started", params: { thread: { id: "th_1" } } });
        send({ id: msg.id, result: {} });
        break;
      case "ask":
        // A server→client request. Whatever comes back is echoed as a notification so the test can
        // read the client's answer off the wire.
        send({ id: 9001, method: msg.params.ask, params: { q: 1 } });
        break;
      case "hang":
        break;
      case "die":
        process.exit(3);
        break;
      default:
        if (msg.id === 9001) send({ method: "answered", params: msg });
        break;
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

let dir: string;
let fake: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tr-codex-app-"));
  fake = path.join(dir, "fake-codex");
  writeFileSync(fake, FAKE_CODEX);
  chmodSync(fake, 0o755);
});

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (over: Partial<Parameters<typeof startCodexAppServer>[0]> = {}) =>
  startCodexAppServer({ command: fake, cwd: dir, ...over });

/** Resolves with the first notification of that method. */
function nextNotification(server: CodexAppServer, method: string): Promise<unknown> {
  return new Promise((resolve) => {
    server.onNotification((m, params) => { if (m === method) resolve(params); });
  });
}

describe("startCodexAppServer", () => {
  it("launches the binary in app-server mode and round-trips a request", async () => {
    const server = open();
    const result = await server.request<{ got: unknown; argv: string[] }>("echo", { hello: "world" });
    expect(result.got).toEqual({ hello: "world" });
    expect(result.argv).toEqual(["app-server"]);
    await server.close();
  });

  it("passes extra argv through after app-server", async () => {
    const server = open({ args: ["-c", "model=gpt-5.6-sol"] });
    const result = await server.request<{ argv: string[] }>("echo");
    expect(result.argv).toEqual(["app-server", "-c", "model=gpt-5.6-sol"]);
    await server.close();
  });

  it("pairs concurrent requests with their own answers", async () => {
    const server = open();
    const [a, b] = await Promise.all([
      server.request<{ got: { n: number } }>("echo", { n: 1 }),
      server.request<{ got: { n: number } }>("echo", { n: 2 }),
    ]);
    expect([a.got.n, b.got.n]).toEqual([1, 2]);
    await server.close();
  });

  it("rejects with the server's own error, code and data intact", async () => {
    const server = open();
    await expect(server.request("boom")).rejects.toMatchObject({
      name: "CodexAppServerError", code: -7, data: { why: "test" },
    });
    await expect(server.request("boom")).rejects.toBeInstanceOf(CodexAppServerError);
    await server.close();
  });

  it("skips unparseable and empty lines instead of dying on them", async () => {
    const server = open();
    expect(await server.request("noise")).toBe("survived");
    await server.close();
  });

  it("waits for a whole line before parsing a value split across writes", async () => {
    const server = open();
    expect(await server.request("split")).toBe("whole");
    await server.close();
  });

  it("delivers notifications to every subscriber", async () => {
    const server = open();
    const seen: unknown[] = [];
    server.onNotification((m, params) => { if (m === "thread/started") seen.push(params); });
    const second = nextNotification(server, "thread/started");
    await server.request("notify");
    await second;
    expect(seen).toEqual([{ thread: { id: "th_1" } }]);
    await server.close();
  });

  it("answers a server request with the handler's result", async () => {
    const server = open();
    server.onRequest("item/commandExecution/requestApproval", async () => ({ decision: "accept" }));
    const answered = nextNotification(server, "answered");
    server.notify("ask", { ask: "item/commandExecution/requestApproval" });
    expect(await answered).toMatchObject({ id: 9001, result: { decision: "accept" } });
    await server.close();
  });

  it("refuses an unhandled server request rather than leaving codex waiting forever", async () => {
    const server = open();
    const answered = nextNotification(server, "answered");
    server.notify("ask", { ask: "something/weNeverImplemented" });
    expect(await answered).toMatchObject({ id: 9001, error: { code: -32601 } });
    await server.close();
  });

  it("reports a handler that throws as an error, not as silence", async () => {
    const server = open();
    server.onRequest("item/tool/requestUserInput", async () => { throw new Error("handler exploded"); });
    const answered = nextNotification(server, "answered");
    server.notify("ask", { ask: "item/tool/requestUserInput" });
    expect(await answered).toMatchObject({ id: 9001, error: { code: -32603, message: "handler exploded" } });
    await server.close();
  });

  it("forwards stderr to the diagnostic sink and keeps it out of the protocol", async () => {
    const chunks: string[] = [];
    const server = open({ onStderr: (c) => chunks.push(c) });
    await server.request("echo");
    expect(chunks.join("")).toContain("warming up");
    await server.close();
  });

  it("fails everything in flight when the child dies", async () => {
    const server = open();
    const hung = server.request("hang");
    server.notify("die");
    await expect(hung).rejects.toThrow(/exited \(3\)/);
    expect(await server.exited).toBe(3);
    expect(server.alive()).toBe(false);
  });

  it("refuses new requests once it has stopped", async () => {
    const server = open();
    await server.close();
    await expect(server.request("echo")).rejects.toThrow(/not running/);
  });

  it("shuts the child down by closing stdin, and is safe to close twice", async () => {
    const server = open();
    await server.request("echo");
    await server.close();
    expect(await server.exited).toBe(0);
    await server.close();
  });

  it("reports a binary that will not start instead of hanging", async () => {
    const server = startCodexAppServer({ command: path.join(dir, "no-such-codex"), cwd: dir });
    await expect(server.request("echo")).rejects.toThrow(/could not start/);
    expect(await server.exited).toBeNull();
  });
});
