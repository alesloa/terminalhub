import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listProcesses, killProcess } from "../system/processes.js";
import { listListeningPorts } from "../system/ports.js";
import { readSystemStats } from "../system/stats.js";
import { revealInFileManager } from "../system/reveal.js";
import { openInDefaultApp } from "../system/open.js";

export async function systemRoutes(app: FastifyInstance) {
  // Live CPU / RAM / network for the system-monitor bar. Polled (~2s) by the client.
  app.get("/api/system/stats", async (_req, reply) => {
    try {
      return { stats: await readSystemStats() };
    } catch (err: any) {
      return reply.code(500).send({ error: "cannot read system stats", code: err.code });
    }
  });

  app.get("/api/system/processes", async (_req, reply) => {
    try {
      return { processes: await listProcesses() };
    } catch (err: any) {
      return reply.code(500).send({ error: "cannot list processes", code: err.code });
    }
  });

  app.get("/api/system/ports", async (_req, reply) => {
    try {
      return { ports: await listListeningPorts() };
    } catch (err: any) {
      return reply.code(500).send({ error: "cannot list ports", code: err.code });
    }
  });

  app.post("/api/system/kill", async (req, reply) => {
    const b = z.object({ pid: z.number().int().positive(), signal: z.enum(["TERM", "KILL"]).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "valid pid required" });
    try {
      killProcess(b.data.pid, b.data.signal ?? "TERM");
      return { ok: true };
    } catch (err: any) {
      const msg = err.code === "ESRCH" ? "no such process" : err.code === "EPERM" ? "permission denied" : "cannot kill process";
      return reply.code(400).send({ error: msg, code: err.code });
    }
  });

  // Best-effort "Reveal in Finder/Explorer". The browser must be on the host machine for
  // this to be visible (the client only shows it on loopback), so we fire-and-forget.
  app.post("/api/system/reveal", async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "valid path required" });
    revealInFileManager(b.data.path);
    return { ok: true };
  });

  // Best-effort "Open in Default App" — same loopback caveat as reveal; fire-and-forget.
  app.post("/api/system/open", async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "valid path required" });
    openInDefaultApp(b.data.path);
    return { ok: true };
  });
}
