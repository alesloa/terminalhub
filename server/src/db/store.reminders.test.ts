import { describe, it, expect, beforeEach } from "vitest";
import { createStore, type Store } from "./store.js";

let store: Store;
beforeEach(() => { store = createStore(":memory:"); });

const T = Date.UTC(2026, 5, 13, 9, 0, 0); // a fixed reference instant

describe("store: reminders — create/read defaults", () => {
  it("creates with an rem_ id and sensible defaults", () => {
    const r = store.createReminder({ title: "Standup", fireAt: T });
    expect(r.id).toMatch(/^rem_/);
    expect(r.title).toBe("Standup");
    expect(r.body).toBe("");
    expect(r.fireAt).toBe(T);
    expect(r.allDay).toBe(false);
    expect(r.endAt).toBeNull();
    expect(r.leadMinutes).toBe(0);
    expect(r.channels).toEqual({ inApp: true, pushover: false, speak: true });
    expect(r.level).toBe("info");
    expect(r.priority).toBe(0);
    expect(r.recurrence).toBeNull();
    expect(r.status).toBe("pending");
    expect(r.firedAt).toBeNull();
    expect(r.wasMissed).toBe(false);
    expect(store.getReminder(r.id)?.title).toBe("Standup");
  });

  it("round-trips channels + recurrence JSON verbatim", () => {
    const r = store.createReminder({
      title: "Weekly review", fireAt: T,
      channels: { inApp: false, pushover: true, speak: false },
      recurrence: { freq: "weekly", interval: 2, until: null, count: null },
    });
    const got = store.getReminder(r.id)!;
    expect(got.channels).toEqual({ inApp: false, pushover: true, speak: false });
    expect(got.recurrence).toEqual({ freq: "weekly", interval: 2, until: null, count: null });
  });
});

describe("store: reminders — list filters", () => {
  it("filters by status and by fireAt range", () => {
    const a = store.createReminder({ title: "A", fireAt: T });
    const b = store.createReminder({ title: "B", fireAt: T + 86_400_000 });
    store.updateReminder(b.id, { status: "cancelled" });
    expect(store.listReminders().map(r => r.title)).toEqual(["A", "B"]);
    expect(store.listReminders({ status: ["pending"] }).map(r => r.title)).toEqual(["A"]);
    expect(store.listReminders({ from: T + 1, to: T + 2 * 86_400_000 }).map(r => r.title)).toEqual(["B"]);
    expect(a.id).toMatch(/^rem_/);
  });
});

describe("store: reminders — due selection", () => {
  it("returns pending reminders at or past their fire instant, excludes future ones", () => {
    const past = store.createReminder({ title: "past", fireAt: T - 1000 });
    store.createReminder({ title: "future", fireAt: T + 1000 });
    const due = store.dueReminders(T);
    expect(due.map(r => r.id)).toEqual([past.id]);
  });

  it("honors leadMinutes — fires lead minutes before fireAt", () => {
    const r = store.createReminder({ title: "lead", fireAt: T + 10 * 60_000, leadMinutes: 10 });
    // effective due instant = fireAt - 10min = T
    expect(store.dueReminders(T - 1).map(x => x.id)).toEqual([]); // 1ms before the lead window opens
    expect(store.dueReminders(T).map(x => x.id)).toEqual([r.id]); // exactly 10min before fireAt
  });

  it("excludes fired and cancelled reminders", () => {
    const f = store.createReminder({ title: "f", fireAt: T - 1000 });
    const c = store.createReminder({ title: "c", fireAt: T - 1000 });
    store.markFired(f.id, { now: T });
    store.updateReminder(c.id, { status: "cancelled" });
    expect(store.dueReminders(T).map(r => r.id)).toEqual([]);
  });

  it("fires a snoozed reminder only once its snoozeUntil passes", () => {
    const r = store.createReminder({ title: "s", fireAt: T - 1000 });
    store.snoozeReminder(r.id, T + 60_000);
    expect(store.getReminder(r.id)?.status).toBe("snoozed");
    expect(store.dueReminders(T).map(x => x.id)).toEqual([]);          // snoozed into the future
    expect(store.dueReminders(T + 60_000).map(x => x.id)).toEqual([r.id]); // snoozeUntil reached
  });
});

describe("store: reminders — markFired", () => {
  it("a one-time reminder becomes fired with a firedAt and is not due again", () => {
    const r = store.createReminder({ title: "once", fireAt: T - 1000 });
    store.markFired(r.id, { now: T });
    const got = store.getReminder(r.id)!;
    expect(got.status).toBe("fired");
    expect(got.firedAt).toBe(T);
    expect(store.dueReminders(T + 10_000).map(x => x.id)).toEqual([]);
  });

  it("tags a boot catch-up fire as missed", () => {
    const r = store.createReminder({ title: "late", fireAt: T - 86_400_000 });
    store.markFired(r.id, { now: T, wasMissed: true });
    expect(store.getReminder(r.id)?.wasMissed).toBe(true);
  });

  it("a daily recurring reminder rolls fireAt forward and stays pending", () => {
    const r = store.createReminder({ title: "daily", fireAt: T - 1000, recurrence: { freq: "daily", interval: 1, until: null, count: null } });
    store.markFired(r.id, { now: T });
    const got = store.getReminder(r.id)!;
    expect(got.status).toBe("pending");
    expect(got.fireAt).toBe((T - 1000) + 86_400_000);
    expect(got.firedAt).toBe(T);
  });

  it("fast-forwards a recurring reminder past missed occurrences to the next future one in a single fire", () => {
    const r = store.createReminder({ title: "daily", fireAt: T, recurrence: { freq: "daily", interval: 1, until: null, count: null } });
    // server was down ~3.5 days; firing now should land on the next occurrence strictly after now,
    // not just one step forward (so the user gets ONE missed ping, not 4).
    const now = T + Math.floor(3.5 * 86_400_000);
    store.markFired(r.id, { now, wasMissed: true });
    const got = store.getReminder(r.id)!;
    expect(got.status).toBe("pending");
    expect(got.fireAt).toBeGreaterThan(now);
    expect(got.fireAt).toBe(T + 4 * 86_400_000); // first daily occurrence after now
  });

  it("a count-capped recurrence stops after the final occurrence", () => {
    const r = store.createReminder({ title: "twice", fireAt: T, recurrence: { freq: "daily", interval: 1, until: null, count: 2 } });
    store.markFired(r.id, { now: T });                 // occurrence 1 of 2
    expect(store.getReminder(r.id)?.status).toBe("pending");
    expect(store.getReminder(r.id)?.recurrence?.count).toBe(1);
    store.markFired(r.id, { now: T + 86_400_000 });    // occurrence 2 of 2 -> done
    expect(store.getReminder(r.id)?.status).toBe("fired");
  });
});

describe("store: reminders — update + delete", () => {
  it("edits content and time", () => {
    const r = store.createReminder({ title: "A", fireAt: T });
    const updated = store.updateReminder(r.id, { title: "B", fireAt: T + 5000, leadMinutes: 15, priority: 1 });
    expect(updated?.title).toBe("B");
    expect(updated?.fireAt).toBe(T + 5000);
    expect(updated?.leadMinutes).toBe(15);
    expect(updated?.priority).toBe(1);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(r.updatedAt);
  });

  it("deletes a reminder", () => {
    const r = store.createReminder({ title: "A", fireAt: T });
    store.deleteReminder(r.id);
    expect(store.getReminder(r.id)).toBeUndefined();
  });
});

describe("store: notifications — durable history", () => {
  it("creates, lists newest-first, and counts unread", () => {
    const a = store.createNotification({ title: "first", body: "1", firedAt: T });
    const b = store.createNotification({ title: "second", body: "2", firedAt: T + 1000 });
    expect(a.id).toMatch(/^nf_/);
    expect(store.listNotifications().map(n => n.title)).toEqual(["second", "first"]);
    expect(store.unreadNotificationCount()).toBe(2);
    store.markNotificationRead(b.id);
    expect(store.unreadNotificationCount()).toBe(1);
    store.markAllNotificationsRead();
    expect(store.unreadNotificationCount()).toBe(0);
  });

  it("captures Pushover delivery result and missed flag", () => {
    const n = store.createNotification({ title: "x", firedAt: T, pushover: true, pushoverOk: false, wasMissed: true });
    const got = store.listNotifications()[0];
    expect(got.pushover).toBe(true);
    expect(got.pushoverOk).toBe(false);
    expect(got.wasMissed).toBe(true);
    expect(n.read).toBe(false);
  });

  it("clears all notifications", () => {
    store.createNotification({ title: "x", firedAt: T });
    store.clearNotifications();
    expect(store.listNotifications()).toEqual([]);
  });
});

describe("store: reminder images", () => {
  it("stores, upserts, reads, and deletes a reminder image data URL", () => {
    const r = store.createReminder({ title: "x", fireAt: T });
    expect(store.getReminderImage(r.id)).toBeUndefined();
    store.setReminderImage(r.id, "data:image/png;base64,ABC");
    expect(store.getReminderImage(r.id)).toBe("data:image/png;base64,ABC");
    store.setReminderImage(r.id, "data:image/jpeg;base64,XYZ");
    expect(store.getReminderImage(r.id)).toBe("data:image/jpeg;base64,XYZ");
    store.deleteReminderImage(r.id);
    expect(store.getReminderImage(r.id)).toBeUndefined();
  });

  it("drops the image when the reminder is deleted", () => {
    const r = store.createReminder({ title: "x", fireAt: T });
    store.setReminderImage(r.id, "data:image/png;base64,ABC");
    store.deleteReminder(r.id);
    expect(store.getReminderImage(r.id)).toBeUndefined();
  });
});

describe("store: settings — Pushover keys default to null", () => {
  it("starts unconfigured", () => {
    const s = store.getSettings();
    expect(s.pushoverToken).toBeNull();
    expect(s.pushoverUser).toBeNull();
  });

  it("persists raw keys (the route is what strips them on GET)", () => {
    store.setSettings({ pushoverToken: "atoken", pushoverUser: "auser" });
    const s = store.getSettings();
    expect(s.pushoverToken).toBe("atoken");
    expect(s.pushoverUser).toBe("auser");
  });
});
