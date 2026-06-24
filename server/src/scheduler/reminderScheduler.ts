import type { Store } from "../db/store.js";
import { notifyCategory, type NotifyBus } from "../notify/bus.js";
import type { PushoverController } from "../pushover/client.js";
import type { Reminder } from "../types.js";

// The reminder scheduler — the first server-side timer in Terminal Hub. A polling ticker (NOT per-event
// setTimeout, which wouldn't survive a restart): every `intervalMs` it asks the store for due
// reminders and fires each. `catchUp()` runs once at boot to fire reminders that came due while the
// server was down, tagged "(missed)". Durable across restarts; ~30s granularity is plenty for a
// calendar. All instants are epoch-ms UTC, so the server timezone is irrelevant.

const DEFAULT_INTERVAL_MS = 30_000;

export interface ReminderScheduler {
  tick(now?: number): Promise<void>;     // one due-scan + fire pass
  catchUp(now?: number): Promise<void>;  // boot reconcile: fire overdue reminders late, tagged missed
  start(): void;                         // begin the polling loop
  stop(): void;                          // stop the loop
}

export interface SchedulerDeps {
  store: Store;
  notify: NotifyBus;
  pushover: PushoverController;
  intervalMs?: number;
  // How the in-app toast references a reminder's image; null-returning = no thumbnail. Overridable
  // for tests. Default points at the authed image route.
  imageUrlFor?: (rem: Reminder) => string | undefined;
}

// Parse a stored `data:<mime>;base64,<data>` URL into the pieces Pushover wants. Returns null for
// anything that isn't a base64 data URL.
function parseDataUrl(dataUrl: string): { base64: string; type: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { type: m[1], base64: m[2] };
}

export function createReminderScheduler(deps: SchedulerDeps): ReminderScheduler {
  const { store, notify, pushover } = deps;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const imageUrlFor = deps.imageUrlFor ?? ((rem: Reminder) => (rem.imagePath ? `/api/reminders/${rem.id}/image` : undefined));

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false; // guards against overlapping ticks if a fire (Pushover) runs long

  async function fire(rem: Reminder, now: number, wasMissed: boolean) {
    const prefix = wasMissed ? "(missed) " : "";
    const title = prefix + (rem.title || "Reminder");
    const text = rem.body?.trim() ? rem.body : rem.title || "Reminder";

    let pushoverAttempted = false;
    let pushoverOk: boolean | null = null;
    if (rem.channels.pushover && pushover.isConfigured()) {
      pushoverAttempted = true;
      let img: { base64: string; type: string } | null = null;
      if (rem.imagePath) {
        const dataUrl = store.getReminderImage(rem.id);
        if (dataUrl) img = parseDataUrl(dataUrl);
      }
      const res = await pushover.send({
        message: text, title, priority: rem.priority,
        imageBase64: img?.base64, imageType: img?.type,
      });
      pushoverOk = res.ok;
    }

    // Persist first (records the Pushover result), then publish the live toast carrying that durable
    // id so a dashboard can read/remove it and the in-app frame stays in sync with the center.
    const note = store.createNotification({
      reminderId: rem.id, title, body: text, level: rem.level, category: notifyCategory(rem.level, "reminder"),
      imagePath: rem.imagePath, wasMissed, pushover: pushoverAttempted, pushoverOk, firedAt: now,
    });

    if (rem.channels.inApp) {
      notify.publish({
        id: note.id, title, text, level: rem.level, category: note.category, source: "reminder",
        speak: rem.channels.speak, imageUrl: rem.imagePath ? imageUrlFor(rem) : undefined, ts: now,
      });
    }

    store.markFired(rem.id, { now, wasMissed });
  }

  async function run(now: number, wasMissed: boolean) {
    if (running) return;
    running = true;
    try {
      for (const rem of store.dueReminders(now)) {
        try { await fire(rem, now, wasMissed); }
        catch { /* one bad reminder must not stall the rest of the batch */ }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick(now = Date.now()) { return run(now, false); },
    catchUp(now = Date.now()) { return run(now, true); },
    start() {
      if (timer) return;
      timer = setInterval(() => { void this.tick(); }, intervalMs);
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
