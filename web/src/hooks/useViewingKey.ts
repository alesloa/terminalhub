// RETIRED. The notification layer no longer asks "which room is on top" — it now uses a single,
// truer signal: which terminal PANE currently holds xterm focus (the green :focus-within bar), stored
// as useUi().focusedTerminalId and set by useTerminalSocket. A finishing agent alerts you unless that
// exact pane is focused in this browser AND the tab is on-screen. See useNotificationSocket /
// useClearViewedNotifications / useTerminalSocket. This file has no importers and can be deleted.
export {};
