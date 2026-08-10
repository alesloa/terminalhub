// What the composer's pills know about the config they edit. Deliberately thin: the model catalog
// itself is never listed here — it arrives from the server, which reads it off the installed CLI.
// The only literals in this file are the contract constants and the human labels for the fixed
// enums (effort levels, permission modes) that the shared type already spells out.

import type { GuiConfig, GuiEffort, GuiEffortLevel, GuiModel, GuiPermissionMode } from "../../api/guiTypes";

/** Suffix the CLI understands on a model id to select its 1M-token context variant. Mirrors
 *  CONTEXT_1M_SUFFIX in server/src/gui/config.ts. This is the ONLY string ever appended to a model
 *  id, and only ever onto a catalog row's own `base` — model ids are never assembled from anything
 *  the server didn't hand us. */
export const CONTEXT_1M_SUFFIX = "[1m]";

/** The model id for one of a row's two context windows, built from that row's `base`. */
export function withContextWindow(base: string, oneM: boolean): string {
  return oneM ? `${base}${CONTEXT_1M_SUFFIX}` : base;
}

/** Is the currently-selected id the 1M form? */
export function isContext1m(model: string | null): boolean {
  return model !== null && model.endsWith(CONTEXT_1M_SUFFIX);
}

function baseOf(model: string): string {
  return model.endsWith(CONTEXT_1M_SUFFIX) ? model.slice(0, -CONTEXT_1M_SUFFIX.length) : model;
}

/**
 * The catalog row the composer is currently sitting on.
 *
 * `null` means "pass no --model", which the CLI's own catalog normally also offers as a row with the
 * value "default" — so that row, when it exists, is what a null selection displays. A `[1m]`
 * selection falls back to the row sharing its base, since the catalog may list only the 200k form.
 * Returns null when nothing matches; callers show the raw id rather than invent a row.
 */
export function findModel(models: GuiModel[], model: string | null): GuiModel | null {
  if (model === null) return models.find((m) => m.value === "default") ?? null;
  return models.find((m) => m.value === model) ?? models.find((m) => m.base === baseOf(model)) ?? null;
}

export const EFFORT_LABELS: Record<GuiEffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

/** The level the CLI lands on when no effort is chosen — flagged in the menu so the list reads as
 *  "this is the one you already have". */
export const DEFAULT_EFFORT: GuiEffortLevel = "high";

const EXTRA_EFFORT_LABELS: Record<"ultracode" | "ultrathink", string> = {
  ultracode: "Ultracode",
  ultrathink: "Ultrathink",
};

export function effortLabel(effort: GuiEffort): string {
  return effort === "ultracode" || effort === "ultrathink" ? EXTRA_EFFORT_LABELS[effort] : EFFORT_LABELS[effort];
}

/** Does this model give the reasoning pill anything to open? A model with no effort support and no
 *  context or fast-mode variants (Haiku) would open an empty menu, so the pill is hidden instead. */
export function hasReasoningOptions(m: GuiModel): boolean {
  return m.supportsEffort || m.effortLevels.length > 0 || m.supportsContext1m || m.supportsFastMode;
}

/** The pill's closed-state label: every active choice, joined. e.g. "High · 1M".
 *
 *  With no effort chosen the pill says "Default" rather than naming a level — we genuinely don't
 *  pass `--effort` in that case, and the user's own ~/.claude `effortLevel` may be anything, so
 *  claiming "High" would be a guess dressed as a fact. */
export function reasoningLabel(model: GuiModel, config: GuiConfig): string {
  const parts: string[] = [];
  if (model.supportsEffort || model.effortLevels.length > 0) {
    parts.push(config.effort ? effortLabel(config.effort) : "Default");
  }
  if (model.supportsContext1m) parts.push(isContext1m(config.model) ? "1M" : "200k");
  return parts.join(" · ") || "Reasoning";
}

export interface PermissionOption {
  id: GuiPermissionMode;
  label: string;
  description: string;
  /** Full access is the only one that bypasses every prompt — it gets the open padlock and a warn
   *  tint so you can see it from across the room. */
  unlocked?: boolean;
}

export const PERMISSION_OPTIONS: PermissionOption[] = [
  { id: "approval-required", label: "Supervised", description: "Ask before commands and file changes." },
  { id: "auto-accept-edits", label: "Auto-accept edits", description: "Auto-approve edits, ask before other actions." },
  { id: "auto", label: "Auto", description: "Supported providers approve routine actions; others still ask." },
  { id: "full-access", label: "Full access", description: "Allow commands and edits without prompts.", unlocked: true },
];
