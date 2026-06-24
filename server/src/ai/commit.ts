// Prompt builder for AI commit-message generation. The model is asked to return ONLY
// the message (Conventional Commits), which the user then edits before committing — so
// no AI attribution is ever injected into the commit itself.

const MAX_DIFF = 40_000; // keep the request small; large diffs get truncated like t3code

// The default instructions. Editable per-install via AiConfig.commitPrompt; the file list
// and staged diff below are always appended by the server, so a custom prompt can't drop them.
export const DEFAULT_COMMIT_INSTRUCTIONS = [
  "Write a git commit message for the staged changes shown below.",
  "Format: Conventional Commits — `<type>: <subject>` where type is one of",
  "feat, fix, docs, style, refactor, perf, test, build, ci, chore.",
  "Rules: imperative mood, lowercase subject, no trailing period, subject <= 72 chars.",
  "If the change is non-trivial, add a blank line then a short body of `- ` bullet points.",
  "Output ONLY the commit message text. No backticks, no preamble, no explanation.",
].join("\n");

export function buildCommitPrompt(diff: string, nameStatus: string, instructions?: string): string {
  const d = diff.length > MAX_DIFF ? diff.slice(0, MAX_DIFF) + "\n…(diff truncated)" : diff;
  return [
    instructions?.trim() || DEFAULT_COMMIT_INSTRUCTIONS,
    "",
    "Files changed:",
    nameStatus.trim() || "(none reported)",
    "",
    "Staged diff:",
    d.trim(),
  ].join("\n");
}

const MAX_INITIAL_ENTRIES = 200; // cap the top-level listing so the prompt stays small on huge folders

// Prompt for the FIRST commit of a brand-new repo. There's no diff yet (nothing tracked), so the
// model summarizes the project from its top-level files/folders instead of a staged diff. Reuses the
// same (editable) commit instructions so the output format matches a normal commit message.
export function buildInitialCommitPrompt(entries: string[], instructions?: string): string {
  const shown = entries.slice(0, MAX_INITIAL_ENTRIES);
  const more = entries.length > shown.length ? `\n…and ${entries.length - shown.length} more` : "";
  return [
    instructions?.trim() || DEFAULT_COMMIT_INSTRUCTIONS,
    "",
    "This is the FIRST commit of a brand-new repository — there is no prior diff. Infer what the",
    "project is from its top-level files and folders below and write a concise initial-commit message.",
    "",
    "Top-level contents:",
    shown.map(e => `- ${e}`).join("\n") + more,
  ].join("\n");
}
