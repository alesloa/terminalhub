import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStore, type Store } from "../db/store.js";
import { createNotifyBus, type Notification } from "../notify/bus.js";
import { createReminderScheduler } from "./reminderScheduler.js";

let store: Store;
let published: Notification[];
let notify: ReturnType<typeof createNotifyBus>;
let pushover: any;

beforeEach(() => {
  store = createStore(":memory:");
  published = [];
  notify = createNotifyBus();
  notify.subscribe((n) => published.push(n));
  pushover = {
    isConfigured: () => true,
    send: vi.fn().mockResolvedValue({ ok: true, errors: [], quota: null, request: "r" }),
    validate: vi.fn(),
    quota: vi.fn(),
  };
});

const make = () => createReminderScheduler({ store, notify, pushover });
const NOW = Date.UTC(2026, 5, 13, 12, 0, 0);

describe("reminderScheduler — firing", () => {
  it("fires an in-app reminder: publishes a toast, persists it, marks it fired", async () => {
    const r = store.createReminder({ title: "Standup", body: "daily sync", fireAt: NOW - 1000 });
    await make().tick(NOW);

    expect(published).toHaveLength(1);
    expect(published[0].title).toBe("Standup");
    expect(published[0].text).toBe("daily sync");
    expect(published[0].speak).toBe(true);

    const notes = store.listNotifications();
    expect(notes).toHaveLength(1);
    expect(notes[0].reminderId).toBe(r.id);
    expect(store.getReminder(r.id)?.status).toBe("fired");
    expect(pushover.send).not.toHaveBeenCalled(); // pushover channel was off
  });

  it("routes to Pushover (and not the toast) when only the pushover channel is on", async () => {
    store.createReminder({ title: "Ping", fireAt: NOW - 1000, priority: 1, channels: { inApp: false, pushover: true, speak: false } });
    await make().tick(NOW);
    expect(published).toHaveLength(0);
    expect(pushover.send).toHaveBeenCalledTimes(1);
    const arg = pushover.send.mock.calls[0][0];
    expect(arg.message).toBe("Ping");
    expect(arg.priority).toBe(1);
  });

  it("passes the speak flag through to the toast", async () => {
    store.createReminder({ title: "Quiet", fireAt: NOW - 1000, channels: { inApp: true, pushover: false, speak: false } });
    await make().tick(NOW);
    expect(published[0].speak).toBe(false);
  });

  it("attaches a stored image to the Pushover push", async () => {
    const r = store.createReminder({ title: "Look", fireAt: NOW - 1000, channels: { inApp: false, pushover: true, speak: false } });
    store.setReminderImage(r.id, "data:image/png;base64,ABC123");
    store.updateReminder(r.id, { imagePath: `/api/reminders/${r.id}/image` });
    await make().tick(NOW);
    const arg = pushover.send.mock.calls[0][0];
    expect(arg.imageBase64).toBe("ABC123");
    expect(arg.imageType).toBe("image/png");
  });

  it("does not fire reminders that are not yet due", async () => {
    store.createReminder({ title: "Future", fireAt: NOW + 60_000 });
    await make().tick(NOW);
    expect(published).toHaveLength(0);
  });
});

describe("reminderScheduler — boot catch-up", () => {
  it("fires overdue reminders late, tagged missed", async () => {
    const r = store.createReminder({ title: "Overdue", fireAt: NOW - 86_400_000 });
    await make().catchUp(NOW);
    expect(published).toHaveLength(1);
    expect(published[0].title).toMatch(/^\(missed\) /);
    const note = store.listNotifications()[0];
    expect(note.wasMissed).toBe(true);
    expect(store.getReminder(r.id)?.wasMissed).toBe(true);
    expect(store.getReminder(r.id)?.status).toBe("fired");
  });
});

describe("reminderScheduler — snooze", () => {
  it("fires a snoozed reminder only once its snooze passes, without double-firing", async () => {
    const r = store.createReminder({ title: "Snoozed", fireAt: NOW - 1000 });
    store.snoozeReminder(r.id, NOW + 60_000);
    const s = make();
    await s.tick(NOW);
    expect(published).toHaveLength(0);
    await s.tick(NOW + 60_000);
    expect(published).toHaveLength(1);
    await s.tick(NOW + 120_000);
    expect(published).toHaveLength(1); // already fired, not again
  });
});

describe("reminderScheduler — resilience", () => {
  it("a failed Pushover send is recorded but does not crash the tick or block in-app", async () => {
    pushover.send.mockResolvedValue({ ok: false, errors: ["down"], quota: null });
    const r = store.createReminder({ title: "Both", fireAt: NOW - 1000, channels: { inApp: true, pushover: true, speak: false } });
    await make().tick(NOW);
    expect(published).toHaveLength(1); // in-app still delivered
    expect(store.getReminder(r.id)?.status).toBe("fired");
    const note = store.listNotifications()[0];
    expect(note.pushover).toBe(true);
    expect(note.pushoverOk).toBe(false);
  });
});

describe("reminderScheduler — interval lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("start() fires due reminders on each tick; stop() halts the loop", async () => {
    const s = createReminderScheduler({ store, notify, pushover, intervalMs: 1000 });
    store.createReminder({ title: "A", fireAt: Date.now() - 1000 });
    s.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(published).toHaveLength(1);
    s.stop();
    store.createReminder({ title: "B", fireAt: Date.now() - 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(published).toHaveLength(1); // stopped — B never fired
  });
});
