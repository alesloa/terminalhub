import { useEffect, useState } from "react";

/** A clock tick aligned to whole seconds (re-schedules itself to fire just after each :00ms, like the
 *  world-clock widget it's ported from) so seconds flip crisply. Returns Date.now() in ms. */
export function useTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: number;
    const loop = () => {
      setNow(Date.now());
      id = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    };
    id = window.setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(id);
  }, []);
  return now;
}

/** A coarse periodic tick for things that don't need per-second updates (e.g. an agenda list). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
