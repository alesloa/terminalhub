import type { ToolDef } from "../types.js";
import { searchFeatures } from "./manifest.js";

// Knowledge tools — let the copilot look up precise feature detail beyond the compact digest already
// in its system prompt. Both search the same capability manifest (sourced from docs/FEATURES.md).
export const knowledgeTools: ToolDef[] = [
  {
    name: "explain_feature",
    description: "Look up what a Terminal Hub feature is and where to find it. Use when the user asks 'what is X', 'do you have X', or you need exact detail about a feature.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Feature name or keywords (e.g. 'stage manager', 'durable terminals')" } },
      required: ["query"],
    },
    async run(args) {
      const query = typeof args?.query === "string" ? args.query : "";
      const hits = searchFeatures(query).map((e) => ({ name: e.name, section: e.section, blurb: e.blurb, howToTrigger: e.howToTrigger }));
      return { ok: true, summary: hits.length ? `Found ${hits.length} matching feature${hits.length === 1 ? "" : "s"}.` : "No matching feature.", data: hits };
    },
  },
  {
    name: "how_do_i",
    description: "Find how to accomplish a task in Terminal Hub (where the feature lives / how to trigger it). Use for 'how do I X' questions.",
    skillId: "core",
    input_schema: {
      type: "object",
      properties: { task: { type: "string", description: "What the user wants to do (e.g. 'clone a repo', 'set a reminder')" } },
      required: ["task"],
    },
    async run(args) {
      const task = typeof args?.task === "string" ? args.task : "";
      const hits = searchFeatures(task).map((e) => ({ name: e.name, howToTrigger: e.howToTrigger, blurb: e.blurb }));
      return { ok: true, summary: hits.length ? `${hits.length} relevant feature${hits.length === 1 ? "" : "s"}.` : "Nothing matched.", data: hits };
    },
  },
];
