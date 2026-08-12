import type { Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";

// The knobs the GUI composer exposes — model, reasoning effort, and how much the agent may do
// without asking — plus the translation into what the Agent SDK actually accepts.
//
// Nothing here hardcodes a model catalog. The list of models, and which effort levels each one
// supports, comes from the installed CLI at runtime via `Query.supportedModels()`; this module only
// deals in the values the user picked from that list. That's deliberate: a baked-in catalog goes
// stale the moment Claude Code ships a new model.

/** Reasoning depth. `low`–`max` are real SDK effort levels; `ultra` is Codex-only (see
 *  gui/codex/config.ts); `ultracode`/`ultrathink` are Claude Code concepts that ride other channels
 *  — see `sdkEffort` / `sdkSettings` / `applyUltrathink`. Which of these a terminal can actually
 *  pick is decided by the model catalog its agent advertises, never by this union. */
export type GuiEffort =
  | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "ultracode" | "ultrathink";

/** How much the agent may do before it has to ask. Mirrors the four-way choice in the composer. */
export type GuiPermissionMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";

export interface GuiConfig {
  /** A `value` from `supportedModels()`, e.g. `"default"`, `"sonnet"`, `"claude-fable-5[1m]"`.
   *  null = don't pass `--model`, let the CLI use its own default. */
  model: string | null;
  /** null = don't pass `--effort`, let the model decide. */
  effort: GuiEffort | null;
  permissionMode: GuiPermissionMode;
  /** Claude Code's fast mode. Only meaningful on models whose ModelInfo says `supportsFastMode`. */
  fastMode: boolean;
}

/** Supervised, not full access: the pane this replaces prompts before it acts, and a GUI that
 *  silently ran commands the terminal would have asked about would be a nasty surprise. One click
 *  changes it and the choice sticks. */
export const DEFAULT_GUI_CONFIG: GuiConfig = {
  model: null,
  effort: null,
  permissionMode: "approval-required",
  fastMode: false,
};

/** Where Claude Code lands when no `--effort` is passed. `ModelInfo` doesn't report a per-model
 *  default, so this one constant covers the whole Claude catalog — Codex answers per model. */
export const CLAUDE_DEFAULT_EFFORT = "high" as const;

/** Suffix the CLI understands on a model id to select its 1M-token context variant. Verified
 *  against the installed CLI, which rejects unknown model ids outright. */
export const CONTEXT_1M_SUFFIX = "[1m]";

/** Prepended to a turn to request maximum thinking. Ultrathink is a prompt keyword, not a flag —
 *  there is no SDK field for it. */
export const ULTRATHINK_PREFIX = "Ultrathink:\n";

const EFFORT_VALUES: readonly GuiEffort[] =
  ["low", "medium", "high", "xhigh", "max", "ultra", "ultracode", "ultrathink"];
const PERMISSION_VALUES: readonly GuiPermissionMode[] =
  ["approval-required", "auto-accept-edits", "auto", "full-access"];

export function isGuiEffort(value: unknown): value is GuiEffort {
  return typeof value === "string" && (EFFORT_VALUES as readonly string[]).includes(value);
}

export function isGuiPermissionMode(value: unknown): value is GuiPermissionMode {
  return typeof value === "string" && (PERMISSION_VALUES as readonly string[]).includes(value);
}

/** Parse a stored/received config, dropping anything unrecognised back to the default. Used for
 *  both the DB blob and the request body so a stale row can never crash a session start. */
export function parseGuiConfig(raw: unknown): GuiConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_GUI_CONFIG };
  const rec = raw as Record<string, unknown>;
  return {
    model: typeof rec.model === "string" && rec.model.trim() ? rec.model.trim() : null,
    effort: isGuiEffort(rec.effort) ? rec.effort : null,
    permissionMode: isGuiPermissionMode(rec.permissionMode) ? rec.permissionMode : DEFAULT_GUI_CONFIG.permissionMode,
    fastMode: rec.fastMode === true,
  };
}

/** The `effort` value to hand the SDK, or undefined when the choice travels another way.
 *  - `ultracode` is not an API effort: it's xhigh plus a Claude Code setting (see `sdkSettings`).
 *  - `ultrathink` is not config at all: it's a prompt prefix (see `applyUltrathink`).
 *  - `ultra` is a Codex level; Claude has no such effort, so it is dropped rather than approximated. */
export function sdkEffort(effort: GuiEffort | null): NonNullable<Options["effort"]> | undefined {
  if (!effort || effort === "ultrathink" || effort === "ultra") return undefined;
  if (effort === "ultracode") return "xhigh";
  return effort;
}

/** The Claude Code settings layer implied by the config. Empty object = pass nothing. */
export function sdkSettings(config: GuiConfig): { ultracode?: boolean; fastMode?: boolean } {
  return {
    ...(config.effort === "ultracode" ? { ultracode: true } : {}),
    ...(config.fastMode ? { fastMode: true } : {}),
  };
}

/** The SDK permission mode, or undefined for Supervised — the SDK's own `'default'` already means
 *  "ask before anything dangerous", so the cleanest way to express it is to not pass the flag. */
export function sdkPermissionMode(mode: GuiPermissionMode): PermissionMode | undefined {
  if (mode === "auto-accept-edits") return "acceptEdits";
  if (mode === "auto") return "auto";
  if (mode === "full-access") return "bypassPermissions";
  return undefined;
}

/** Whether this config bypasses approvals entirely. The SDK demands an explicit opt-in flag
 *  alongside `bypassPermissions`, so the two are always decided together. */
export function bypassesApprovals(config: GuiConfig): boolean {
  return config.permissionMode === "full-access";
}

/** Prefix a turn with the ultrathink keyword when that's the selected depth. Idempotent, and a
 *  no-op when the user already typed the word themselves. */
export function applyUltrathink(text: string, effort: GuiEffort | null): string {
  const trimmed = text.trim();
  if (!trimmed || effort !== "ultrathink") return trimmed;
  if (/\bultrathink\b/i.test(trimmed)) return trimmed;
  return `${ULTRATHINK_PREFIX}${trimmed}`;
}

/** Split a model id into its base and whether the 1M context variant is selected. The composer
 *  presents these as two controls; the CLI takes them as one string. */
export function splitContextWindow(model: string): { base: string; oneM: boolean } {
  return model.endsWith(CONTEXT_1M_SUFFIX)
    ? { base: model.slice(0, -CONTEXT_1M_SUFFIX.length), oneM: true }
    : { base: model, oneM: false };
}

/** Rebuild a model id for the requested context window. */
export function withContextWindow(model: string, oneM: boolean): string {
  const { base } = splitContextWindow(model);
  return oneM ? `${base}${CONTEXT_1M_SUFFIX}` : base;
}
