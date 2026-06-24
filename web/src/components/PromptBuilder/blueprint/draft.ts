import type { BlueprintGraph, AiChatMessage } from "../../../api/types";

// The live, recoverable Blueprint working state — snapshotted to localStorage so an accidental close
// (✕ or re-toggling the launcher), a page refresh, or a browser crash never loses unsaved work. This
// is distinct from a *saved* blueprint (a named row in the DB via the Save button): the draft is
// per-machine, ephemeral, and only ever offered back to the user as "resume where you left off".
const KEY = "tr.blueprintDraft";

export interface BlueprintDraft {
  blueprintId: string | null; // the DB blueprint this draft is editing, if any
  name: string;
  graph: BlueprintGraph;
  chat: AiChatMessage[];
  engineId: string | null;
  targetTool: string;
  polished: string;
  baselineSig: string; // signature of the last *saved* state — lets dirty go back to false on revert
  savedAt: number;
}

/** Content signature for dirty-tracking — only the parts that define the blueprint itself, so picking
 *  a different engine/target tool or regenerating the polished output never counts as a real edit. */
export function signature(name: string, graph: BlueprintGraph, chat: AiChatMessage[]): string {
  return JSON.stringify({ name: name.trim(), graph, chat });
}

export function loadDraft(): BlueprintDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<BlueprintDraft>;
    if (!d || typeof d !== "object" || !d.graph || !Array.isArray(d.graph.nodes) || !Array.isArray(d.graph.edges)) return null;
    return {
      blueprintId: typeof d.blueprintId === "string" ? d.blueprintId : null,
      name: typeof d.name === "string" ? d.name : "",
      graph: d.graph,
      chat: Array.isArray(d.chat) ? d.chat : [],
      engineId: typeof d.engineId === "string" ? d.engineId : null,
      targetTool: typeof d.targetTool === "string" ? d.targetTool : "",
      polished: typeof d.polished === "string" ? d.polished : "",
      baselineSig: typeof d.baselineSig === "string" ? d.baselineSig : "",
      savedAt: typeof d.savedAt === "number" ? d.savedAt : 0,
    };
  } catch { return null; }
}

export function saveDraft(d: BlueprintDraft): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota / blocked */ }
}

export function clearDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* blocked */ }
}
