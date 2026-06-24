import type { Skill } from "./types.js";
import { coreTools } from "../tools/index.js";

// The built-in skill: product knowledge + app-control tools. Always enabled while the copilot is on
// (it's what makes the assistant useful out of the box), so it has no toggle and stores no state.
export const coreSkill: Skill = {
  id: "core",
  name: "App control & knowledge",
  description: "Knows every Terminal Hub feature and can act for you — write notes, manage the to-do board, set reminders, fire alerts, and read your workspaces/terminals.",
  icon: "✦",
  builtin: true,
  accountsProvider: false,
  examples: ["What can you do?", "Add a note", "Set a reminder for 3pm", "Add \"ship copilot\" to my board", "How do I clone a repo?"],
  tools: () => coreTools,
};
