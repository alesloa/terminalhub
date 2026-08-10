import { createContext, useContext } from "react";

/**
 * Whether a turn is running right now, for the transcript below it.
 *
 * This exists so a tool card can never spin on its own. A card renders "running" because its block
 * says so, and a block says so until something settles it — but the thing that settles it is the
 * run, and a run that was killed (CLI crash, hub restart, a socket that reconnected onto a finished
 * conversation) never gets to settle anything. The server closes those blocks out on every teardown
 * path it controls; this is the half that holds when the server never got the chance. If no turn is
 * in flight, nothing is running, whatever the block claims.
 *
 * Defaults to false: the only way to spin is for a live session to say so.
 */
const TurnActiveContext = createContext(false);

export const TurnActiveProvider = TurnActiveContext.Provider;

export function useTurnActive(): boolean {
  return useContext(TurnActiveContext);
}
