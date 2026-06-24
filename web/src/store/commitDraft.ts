import { create } from "zustand";
import { api } from "../api/client";

/**
 * Per-repo commit draft: the message text plus the AI ✨ generation status/error. This lives in a
 * store (not in ChangesSection's local state) so it SURVIVES the Git panel unmounting — switching
 * the side bar to the File Explorer and back tears the panel down, and an in-flight `generate` used
 * to be orphaned (its result landed on a dead component and was lost). Now the fetch runs in the
 * store action, so it keeps going regardless of which side panel is showing; the panel just
 * subscribes and picks the result back up when it remounts. Keyed by repo path, so each workspace
 * (and drilled-into submodule) keeps its own draft and its own in-flight generation.
 */
export interface CommitDraft {
  msg: string;
  generating: boolean;
  genError: string | null; // last generate failure, surfaced inline in the commit box
}

const EMPTY: CommitDraft = { msg: "", generating: false, genError: null };

interface CommitDraftState {
  drafts: Record<string, CommitDraft>;
  setMsg(rootPath: string, msg: string): void;
  clearError(rootPath: string): void;
  /** Clear the box after a successful commit. Leaves any in-flight `generating` flag alone. */
  reset(rootPath: string): void;
  /** Kick off (or no-op if already running) AI generation for this repo, writing the result into
   *  the store. Resolves with the outcome so the caller can react while mounted (e.g. open AI
   *  settings on "no provider"); the store state is authoritative either way. */
  generate(rootPath: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export const useCommitDraft = create<CommitDraftState>((set, get) => {
  const patch = (rootPath: string, part: Partial<CommitDraft>) =>
    set((s) => ({ drafts: { ...s.drafts, [rootPath]: { ...(s.drafts[rootPath] ?? EMPTY), ...part } } }));
  return {
    drafts: {},
    setMsg: (rootPath, msg) => patch(rootPath, { msg }),
    clearError: (rootPath) => patch(rootPath, { genError: null }),
    reset: (rootPath) => patch(rootPath, { msg: "", genError: null }),
    generate: async (rootPath) => {
      if (get().drafts[rootPath]?.generating) return { ok: false, error: "already generating" };
      patch(rootPath, { generating: true, genError: null });
      try {
        const { message } = await api.ai.commitMessage(rootPath);
        patch(rootPath, { msg: message, generating: false });
        return { ok: true };
      } catch (e) {
        const error = (e as Error).message;
        patch(rootPath, { generating: false, genError: error });
        return { ok: false, error };
      }
    },
  };
});
