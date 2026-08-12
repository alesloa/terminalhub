import type { CodexApprovalPolicy, CodexModel, CodexSandboxMode } from "../../codex/protocol.js";
import type { GuiConfig, GuiEffort } from "../config.js";
import type { GuiEffortLevel, GuiModel } from "../types.js";

// The composer's picks, translated into what `codex app-server` accepts. The Codex twin of
// gui/config.ts — same GuiConfig on the wire, a different agent underneath.
//
// Nothing here hardcodes a model catalog: `model/list` is asked at runtime and the picker is built
// from whatever the installed Codex advertises, exactly like Claude's `supportedModels()`.

/** How much Codex may do before it has to ask, as the two knobs it actually exposes.
 *
 *  Codex splits the decision the way Claude doesn't: `approvalPolicy` is when to ask, `sandbox` is
 *  what is even possible without asking. The four modes the composer offers map onto genuinely
 *  distinct pairs — an "auto" that never interrupts is still confined to the workspace, which is a
 *  different thing from full access. */
export function codexPermissions(
  mode: GuiConfig["permissionMode"],
): { approvalPolicy: CodexApprovalPolicy; sandbox: CodexSandboxMode } {
  switch (mode) {
    case "auto-accept-edits":
      // Codex's own "Auto": work inside the folder runs, anything that escapes it asks.
      return { approvalPolicy: "on-request", sandbox: "workspace-write" };
    case "auto":
      return { approvalPolicy: "never", sandbox: "workspace-write" };
    case "full-access":
      return { approvalPolicy: "never", sandbox: "danger-full-access" };
    default:
      // Supervised. Read-only means every write and every command is an explicit yes.
      return { approvalPolicy: "untrusted", sandbox: "read-only" };
  }
}

/** Reasoning efforts Codex understands. `ultracode` and `ultrathink` are Claude Code concepts with
 *  no Codex equivalent, so they travel as "no effort chosen" rather than as a guess. */
export function codexEffort(effort: GuiEffort | null): string | undefined {
  if (!effort || effort === "ultracode" || effort === "ultrathink") return undefined;
  return effort;
}

/** Effort ids the GUI's own picker can render. A model advertising something outside this set gets
 *  that level dropped rather than shown as an unlabelled button. */
const KNOWN_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max", "ultra"];

/** One `model/list` row → one picker row. Hidden models are the CLI's own business (deprecated or
 *  gated builds) and are filtered out by the caller, not here. */
export function toGuiModel(model: CodexModel): GuiModel {
  const levels = (model.supportedReasoningEfforts ?? [])
    .map((e) => e.reasoningEffort)
    .filter((e): e is GuiEffortLevel => KNOWN_EFFORTS.includes(e));
  // Codex reports a default per model (sol starts on low, others don't), so the menu can flag the row
  // you already have instead of naming a level nobody chose.
  const fallback = model.defaultReasoningEffort;
  return {
    value: model.id,
    displayName: model.displayName,
    description: model.description,
    supportsEffort: levels.length > 0,
    effortLevels: levels,
    defaultEffort: levels.find((l) => l === fallback) ?? null,
    // Both are Claude Code features with no Codex counterpart; the pills stay hidden.
    supportsFastMode: false,
    supportsContext1m: false,
    base: model.id,
    // Codex has no "default" row — it flags one of the real models, and that is what an unset model
    // actually runs, so the picker reads its effort levels rather than showing nothing.
    isDefault: model.isDefault === true,
  };
}

/** The catalog, newest-first as the CLI orders it, with the models it marks hidden removed. */
export function toGuiModels(models: CodexModel[]): GuiModel[] {
  return models.filter((m) => !m.hidden).map(toGuiModel);
}
