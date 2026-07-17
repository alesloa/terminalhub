import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attachHeartbeat } from "./heartbeat.js";

// A fake WS exposing only what attachHeartbeat touches: ping/terminate + a 'pong' listener we fire.
function fakeSocket() {
  let pongCb: (() => void) | undefined;
  return {
    pings: 0,
    terminated: 0,
    ping() { this.pings++; },
    terminate() { this.terminated++; },
    on(event: string, cb: () => void) { if (event === "pong") pongCb = cb; },
    pong() { pongCb?.(); },
  };
}

describe("attachHeartbeat", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps pinging and never terminates while the peer answers each ping", () => {
    const s = fakeSocket();
    attachHeartbeat(s as any, 1000);
    vi.advanceTimersByTime(1000); // tick 1: alive → ping, alive:=false
    expect(s.pings).toBe(1);
    s.pong();                     // peer answers → alive:=true
    vi.advanceTimersByTime(1000); // tick 2: alive → ping
    expect(s.pings).toBe(2);
    s.pong();
    vi.advanceTimersByTime(1000); // tick 3
    expect(s.pings).toBe(3);
    expect(s.terminated).toBe(0);
  });

  it("terminates a peer that stops responding (half-open connection)", () => {
    const s = fakeSocket();
    attachHeartbeat(s as any, 1000);
    vi.advanceTimersByTime(1000); // ping sent, alive:=false (no pong will ever come)
    expect(s.pings).toBe(1);
    expect(s.terminated).toBe(0);
    vi.advanceTimersByTime(1000); // still !alive → terminate
    expect(s.terminated).toBe(1);
  });

  it("stops pinging once the dead peer is terminated (self-clears)", () => {
    const s = fakeSocket();
    attachHeartbeat(s as any, 1000);
    vi.advanceTimersByTime(1000); // ping
    vi.advanceTimersByTime(1000); // terminate + self-clear
    expect(s.terminated).toBe(1);
    vi.advanceTimersByTime(5000); // no further ticks
    expect(s.terminated).toBe(1);
    expect(s.pings).toBe(1);
  });

  it("stop() clears the timer so no more pings fire", () => {
    const s = fakeSocket();
    const stop = attachHeartbeat(s as any, 1000);
    vi.advanceTimersByTime(1000);
    expect(s.pings).toBe(1);
    stop();
    vi.advanceTimersByTime(5000);
    expect(s.pings).toBe(1);
    expect(s.terminated).toBe(0);
  });
});
