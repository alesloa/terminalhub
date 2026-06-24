// In-process pub/sub for server → dashboard notification frames. Three things publish here: a coding
// agent POSTing /api/notify, the reminder scheduler, and the attention watcher (a terminal's agent
// rang the bell). Every open dashboard's /ws/notifications socket subscribes and forwards each frame.
// Single-process. Unlike the old fire-and-forget bus, every notification is ALSO persisted (the
// notifications table) before it's published, so its `id` here is the durable row id — a dashboard can
// read/remove it, and a "removed"/"changed" frame keeps every open browser in sync.

export type NotifyLevel = "info" | "success" | "warn" | "error";
/** The bucket the notification center filters + colors by. */
export type NotifyCategory = "agent" | "error" | "info";
/** What raised the notification — drives the client's voice policy (attention uses the "voice alerts"
 *  setting; notify/reminder use "speak agent messages") and the amber attention toast accent. */
export type NotifySource = "attention" | "notify" | "reminder";

export interface Notification {
  id: string;              // the durable AppNotification row id — clients read/remove it by this
  text: string;
  title?: string;          // small label shown on the toast (e.g. the agent / workspace name)
  level: NotifyLevel;      // toast severity / color
  category: NotifyCategory;// notification-center bucket
  source: NotifySource;    // who raised it (voice policy + toast accent)
  voice?: string;          // system voice name the dashboard should speak it in; undefined = default
  speak: boolean;          // whether the dashboard should read it aloud
  workspaceId?: string;    // deep-link target: clicking the toast opens this room…
  terminalId?: string;     // …and focuses this terminal
  imageUrl?: string;       // optional image shown as a toast thumbnail
  ts: number;
}

/** Frames sent over /ws/notifications. `notification` = a new one (toast + center); `removed` = drop
 *  it everywhere (another browser dismissed/cleared it, or its terminal was viewed); `changed` =
 *  re-fetch the center (read / read-all / clear). */
export type NotifyFrame =
  | ({ type: "notification" } & Notification)
  | { type: "removed"; id: string }
  | { type: "changed" };

/** Pick a center category from the level + source: error/warn is always "error"; an agent source is
 *  "agent"; everything else (reminders, plain info) is "info". */
export function notifyCategory(level: NotifyLevel, source: NotifySource): NotifyCategory {
  if (level === "error" || level === "warn") return "error";
  return source === "reminder" ? "info" : "agent";
}

export interface NotifyBus {
  publish(n: Notification): void;        // a new notification (wraps it as a "notification" frame)
  emit(frame: NotifyFrame): void;        // any control frame (removed / changed)
  subscribe(fn: (frame: NotifyFrame) => void): () => void;
}

export function createNotifyBus(): NotifyBus {
  const subs = new Set<(frame: NotifyFrame) => void>();
  const emit: NotifyBus["emit"] = (frame) => {
    // A dead/erroring socket must not break delivery to the others.
    for (const fn of subs) { try { fn(frame); } catch { /* drop this subscriber's frame */ } }
  };
  return {
    emit,
    publish(n) { emit({ type: "notification", ...n }); },
    subscribe(fn) {
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
  };
}
