/**
 * True only when this tab is BOTH on-screen and the focused window — i.e. you're actually looking at
 * it right now. A tab on another macOS Space, minimized, sitting in the background of the browser, or
 * behind another app (visible but unfocused) all read false. We use this so "you're already watching
 * that terminal" suppression only kicks in when you genuinely are — otherwise a finishing agent on a
 * space/app you've stepped away from would be silently swallowed instead of alerting you.
 */
export function isTabActive(): boolean {
  if (typeof document === "undefined") return true;
  const visible = document.visibilityState === "visible";
  const focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  return visible && focused;
}
