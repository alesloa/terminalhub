// The minimal slice of a ws WebSocket the heartbeat touches. Typed narrowly so tests pass a plain fake.
export interface HeartbeatSocket {
  ping(): void;
  terminate(): void;
  on(event: string, listener: (...args: any[]) => void): void;
}

/** Server-initiated WebSocket liveness. Sends a protocol ping each interval; if the previous ping got
 *  no pong before the next tick, the peer is gone — a half-open TCP connection (browser force-quit,
 *  laptop sleep, tunnel/network drop mid-stream) that will never deliver a FIN — so we terminate() it.
 *  terminate() fires the socket's 'close', which runs the caller's cleanup (killing the attached PTY).
 *
 *  Without this, a vanished client never fires 'close', so its PTY's master fd is pinned forever and
 *  accumulates toward the OS pty cap. An alive browser auto-answers ping frames at the protocol level,
 *  so only a truly dead peer is ever reaped. Returns stop(); the caller MUST run it on 'close' to clear
 *  the timer (the loop also self-clears once it terminates a dead peer). */
export function attachHeartbeat(socket: HeartbeatSocket, intervalMs: number): () => void {
  let alive = true;
  socket.on("pong", () => { alive = true; });

  let timer: ReturnType<typeof setInterval>;
  const stop = () => clearInterval(timer);

  timer = setInterval(() => {
    if (!alive) { stop(); try { socket.terminate(); } catch { /* already gone */ } return; }
    alive = false;
    try { socket.ping(); } catch { /* socket closing */ }
  }, intervalMs);
  // Don't keep the event loop alive just for the heartbeat (matches node-pty/timer usage elsewhere).
  if (typeof (timer as any).unref === "function") (timer as any).unref();

  return stop;
}
