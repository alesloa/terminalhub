// Unused — attention toasts are now fired server-side (server/src/attention/attentionWatcher.ts) and
// rendered, like every other notification, by useNotificationSocket. This makes them one shared,
// cross-browser notification instead of one per open browser. Safe to delete this file; left as a
// stub because the local tooling blocks `rm`. No runtime imports.
export {};
