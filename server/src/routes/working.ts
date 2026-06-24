import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { createWorkingTracker } from "../activity/working.js";

export async function workingRoutes(app: FastifyInstance, ctx: AppContext) {
  // One tracker for the app's lifetime so each poll can diff the pane against the previous sample.
  const tracker = createWorkingTracker(ctx);
  app.get("/api/working", async () => ({ working: await tracker.compute() }));
}
