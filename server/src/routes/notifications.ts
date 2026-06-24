import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

// The notification center's REST surface. Reads the durable `notifications` history the scheduler
// writes on every fire (the live notify bus is fire-and-forget, so this is what survives restarts and
// browser-closed gaps). `unread` drives the bell badge.
export async function notificationRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/api/notifications", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = q.limit != null ? Math.max(1, Math.min(500, Number(q.limit) || 200)) : undefined;
    return { notifications: ctx.store.listNotifications(limit), unread: ctx.store.unreadNotificationCount() };
  });

  // Handle a pending (toast-only) agent notification before its grace window lapses — a click / ✕ on
  // the toast, or viewing its terminal. Cancels the center persist and drops the toast everywhere.
  app.post("/api/notifications/dismiss", async (req) => {
    const id = (req.body as any)?.id as string | undefined;
    if (id) ctx.pending.resolve(id);
    return { ok: true };
  });

  // Every mutation broadcasts a sync frame so other open browsers update live (not just on the slow
  // poll): `changed` → re-fetch the list/badge; `removed` → also drop any matching toast.
  app.post("/api/notifications/read-all", async () => {
    ctx.store.markAllNotificationsRead();
    ctx.notify.emit({ type: "changed" });
    return { ok: true };
  });

  app.post("/api/notifications/:id/read", async (req) => {
    ctx.store.markNotificationRead((req.params as any).id as string);
    ctx.notify.emit({ type: "changed" });
    return { ok: true };
  });

  app.delete("/api/notifications/:id", async (req) => {
    const nid = (req.params as any).id as string;
    ctx.store.deleteNotification(nid);
    ctx.notify.emit({ type: "removed", id: nid });
    return { ok: true };
  });

  // Drop every center entry for a terminal — fired when you open/view it, so going to a terminal you
  // were alerted about clears its notifications automatically. Broadcast only when it removed something.
  app.delete("/api/notifications/terminal/:terminalId", async (req) => {
    const tid = (req.params as any).terminalId as string;
    const removed = ctx.store.deleteNotificationsForTerminal(tid);
    if (removed > 0) ctx.notify.emit({ type: "changed" });
    return { ok: true, removed };
  });

  app.delete("/api/notifications", async () => {
    ctx.store.clearNotifications();
    ctx.notify.emit({ type: "changed" });
    return { ok: true };
  });
}
