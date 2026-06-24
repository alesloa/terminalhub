/**
 * Tiny keyboard-shortcut model shared by the dictation hotkey (and anything else that needs a
 * rebindable combo). A Hotkey is layout-independent: it matches on `KeyboardEvent.code` (physical
 * key) plus modifier flags. `mod` is the platform's primary modifier — ⌘ on macOS, Ctrl elsewhere —
 * so one binding works on both without storing two combos.
 */
export interface Hotkey {
  mod: boolean;   // primary modifier required (Cmd on mac / Ctrl elsewhere)
  shift: boolean;
  alt: boolean;
  code: string;   // KeyboardEvent.code, e.g. "KeyR"
}

/** Default dictation shortcut: UNBOUND (empty code). The old default (Cmd/Ctrl+Shift+R) collided with
 *  the browser's hard-refresh, so dictation now ships with no shortcut — the user binds one in
 *  Settings → Mic shortcut. An empty `code` never matches a real key, so nothing fires while unbound. */
export const DEFAULT_DICTATION_HOTKEY: Hotkey = { mod: false, shift: false, alt: false, code: "" };

/** A hotkey is "bound" only once a real (non-modifier) key sits in `code`; empty = unset/disabled. */
export function isHotkeyBound(hk: Hotkey): boolean {
  return !!hk.code;
}

const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight",
]);

/** True on macOS — picks ⌘ over Ctrl for the primary modifier in labels. */
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");

/** Does this keydown match the bound combo? `mod` accepts either Cmd or Ctrl as the primary. */
export function matchesHotkey(e: KeyboardEvent, hk: Hotkey): boolean {
  return (e.metaKey || e.ctrlKey) === hk.mod && e.shiftKey === hk.shift && e.altKey === hk.alt && e.code === hk.code;
}

/** Build a Hotkey from a keydown. Returns null for a bare modifier press (so capture keeps waiting
 *  for the real key). The caller handles Escape (to cancel) before calling this. */
export function hotkeyFromEvent(e: KeyboardEvent): Hotkey | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  return { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, code: e.code };
}

/** Human label for a combo, e.g. "⌘⇧R" on mac or "Ctrl+Shift+R" elsewhere. An empty `code`
 *  (modifiers only) is allowed — used for live capture feedback before the real key lands. */
export function formatHotkey(hk: Hotkey): string {
  const parts: string[] = [];
  if (hk.mod) parts.push(IS_MAC ? "⌘" : "Ctrl");
  if (hk.alt) parts.push(IS_MAC ? "⌥" : "Alt");
  if (hk.shift) parts.push(IS_MAC ? "⇧" : "Shift");
  if (hk.code) parts.push(keyLabel(hk.code));
  return parts.join(IS_MAC ? "" : "+");
}

/** Live label of the modifiers (and key, if any) currently held — feedback while the user is
 *  pressing a combo into the capture field, so Cmd/Option/Shift show up as they're held. */
export function describeEvent(e: KeyboardEvent): string {
  return formatHotkey({
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    code: MODIFIER_CODES.has(e.code) ? "" : e.code,
  });
}

/** Validate an unknown value (e.g. parsed from localStorage) as a Hotkey, else null. */
export function asHotkey(v: unknown): Hotkey | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.mod === "boolean" && typeof o.shift === "boolean" && typeof o.alt === "boolean" && typeof o.code === "string") {
    return { mod: o.mod, shift: o.shift, alt: o.alt, code: o.code };
  }
  return null;
}

function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);     // KeyR → R
  if (code.startsWith("Digit")) return code.slice(5);   // Digit1 → 1
  if (code.startsWith("Arrow")) return code.slice(5);   // ArrowUp → Up
  if (code === "Space") return "Space";
  return code;
}
