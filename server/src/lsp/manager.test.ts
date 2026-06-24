import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node";
import { createLspManager, type LspSocket } from "./manager.js";

const tick = () => new Promise((r) => setTimeout(r, 5));

/** A fake child process whose stdout/stdin are PassThrough streams we can drive from the test. */
function makeFakeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => { child.emit("exit", 0, null); return true; });
  return child;
}

/** A fake @fastify/websocket socket: records sends/closes, relays .on() through an emitter. */
function makeFakeSocket() {
  const emitter = new EventEmitter();
  const sent: string[] = [];
  let closed: { code?: number; reason?: string } | null = null;
  const socket: LspSocket & { sent: string[]; closedWith: () => typeof closed; emitter: EventEmitter } = {
    OPEN: 1,
    readyState: 1,
    send: (d: string) => { sent.push(d); },
    close: (code?: number, reason?: string) => { closed = { code, reason }; socket.readyState = 3; },
    on: (event: string, cb: (...a: any[]) => void) => { emitter.on(event, cb); },
    sent,
    closedWith: () => closed,
    emitter,
  };
  return socket;
}

const SERVER = { bin: "typescript-language-server", args: ["--stdio"] };

describe("LSP manager", () => {
  it("spawns the server binary in the workspace folder", () => {
    const child = makeFakeChild();
    const spawn = vi.fn(() => child) as any;
    const mgr = createLspManager({ spawn });

    mgr.connect(makeFakeSocket(), { folder: "/work/proj", server: SERVER });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [bin, args, options] = spawn.mock.calls[0];
    expect(bin).toBe("typescript-language-server");
    expect(args).toEqual(["--stdio"]);
    expect(options.cwd).toBe("/work/proj");
  });

  it("frames a raw JSON message from the browser onto the child's stdin", async () => {
    const child = makeFakeChild();
    const mgr = createLspManager({ spawn: (() => child) as any });
    const socket = makeFakeSocket();
    mgr.connect(socket, { folder: "/work", server: SERVER });

    const received: any[] = [];
    new StreamMessageReader(child.stdin).listen((m) => received.push(m));

    socket.emitter.emit("message", Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })));
    await tick();

    expect(received).toEqual([{ jsonrpc: "2.0", id: 1, method: "initialize" }]);
  });

  it("forwards a framed message from the child's stdout to the browser as raw JSON", async () => {
    const child = makeFakeChild();
    const mgr = createLspManager({ spawn: (() => child) as any });
    const socket = makeFakeSocket();
    mgr.connect(socket, { folder: "/work", server: SERVER });

    new StreamMessageWriter(child.stdout).write({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
    await tick();

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({ jsonrpc: "2.0", id: 1, result: { capabilities: {} } });
  });

  it("kills the child when the browser socket closes", () => {
    const child = makeFakeChild();
    const mgr = createLspManager({ spawn: (() => child) as any });
    const socket = makeFakeSocket();
    mgr.connect(socket, { folder: "/work", server: SERVER });

    socket.emitter.emit("close");
    expect(child.kill).toHaveBeenCalled();
  });

  it("closes the socket when the child exits", () => {
    const child = makeFakeChild();
    const mgr = createLspManager({ spawn: (() => child) as any });
    const socket = makeFakeSocket();
    mgr.connect(socket, { folder: "/work", server: SERVER });

    child.emit("exit", 1, null);
    expect(socket.closedWith()).not.toBeNull();
  });

  it("refuses to exceed the concurrent-child cap", () => {
    const spawn = vi.fn(() => makeFakeChild()) as any;
    const mgr = createLspManager({ spawn, maxChildren: 1 });

    mgr.connect(makeFakeSocket(), { folder: "/a", server: SERVER });
    const second = makeFakeSocket();
    const ok = mgr.connect(second, { folder: "/b", server: SERVER });

    expect(ok).toBe(false);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(second.closedWith()).not.toBeNull();
  });

  it("frees a slot after a child exits, allowing a new connection", () => {
    const spawn = vi.fn(() => makeFakeChild()) as any;
    const mgr = createLspManager({ spawn, maxChildren: 1 });

    const first = makeFakeSocket();
    mgr.connect(first, { folder: "/a", server: SERVER });
    first.emitter.emit("close"); // releases the slot

    const ok = mgr.connect(makeFakeSocket(), { folder: "/b", server: SERVER });
    expect(ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
