import type { FileMenuItem } from "../components/Scm/FileContextMenu";

/** Human label for an ignore scope, for success toasts. */
export function ignoreScopeLabel(scope: "local" | "repo"): string {
  return scope === "local" ? "local exclude" : ".gitignore";
}

/**
 * The shared "Add to .gitignore ▸ Local · .gitignore" submenu. Used by every file right-click
 * menu (explorer, Filter Files, source control, editor tabs) so the action is identical
 * everywhere. The two leaves call `onIgnore(scope)`; the backend appends the anchored line to
 * the chosen file (`.git/info/exclude` or the shared `.gitignore`) and runs `git rm --cached`.
 */
export function gitignoreMenuItem(onIgnore: (scope: "local" | "repo") => void): FileMenuItem {
  return {
    label: "Add to .gitignore",
    children: [
      { label: "Local (.git/info/exclude)", onClick: () => onIgnore("local") },
      { label: ".gitignore (shared)", onClick: () => onIgnore("repo") },
    ],
  };
}
