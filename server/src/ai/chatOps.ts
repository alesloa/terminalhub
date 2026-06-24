// The canvas chat can DRIVE the blueprint, not just talk about it. The model returns a JSON
// envelope — { reply, ops } — where `ops` is a list of edits to apply to the React Flow graph.
// This module is the server's half: parse/validate that envelope (robustly — models wrap JSON in
// prose or code fences), and build the node manifest the model needs to target existing cards by id.
// Pure functions, no I/O, so they're trivial to test. The web applies the validated ops to the canvas.

import { z } from "zod";

// The node kinds the model may create or convert to. `start` is excluded on purpose: there is
// exactly one Start (the entry point), never created or converted — mirrors ADDABLE_KINDS on the web.
export const OP_NODE_KINDS = [
  "action", "condition", "loop", "switch", "parallel", "try", "param", "group", "end",
] as const;
export type OpNodeKind = (typeof OP_NODE_KINDS)[number];

/** One edit the AI asks the canvas to make. New nodes are referenced by a model-invented `tempId`
 *  (the web maps it to a real id); existing nodes and edge endpoints by their real id. */
export type BlueprintOp =
  | { op: "add"; tempId: string; kind: OpNodeKind; label?: string; description?: string; cases?: string[] }
  | { op: "update"; id: string; label?: string; description?: string; kind?: OpNodeKind; cases?: string[] }
  | { op: "delete"; id: string }
  | { op: "connect"; from: string; to: string; branch?: string | null }
  | { op: "disconnect"; from: string; to: string; branch?: string | null };

const kind = z.enum(OP_NODE_KINDS);
const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), tempId: z.string().min(1), kind, label: z.string().optional(), description: z.string().optional(), cases: z.array(z.string()).optional() }),
  z.object({ op: z.literal("update"), id: z.string().min(1), label: z.string().optional(), description: z.string().optional(), kind: kind.optional(), cases: z.array(z.string()).optional() }),
  z.object({ op: z.literal("delete"), id: z.string().min(1) }),
  z.object({ op: z.literal("connect"), from: z.string().min(1), to: z.string().min(1), branch: z.string().nullable().optional() }),
  z.object({ op: z.literal("disconnect"), from: z.string().min(1), to: z.string().min(1), branch: z.string().nullable().optional() }),
]);

/**
 * Pull the assistant's reply text + graph ops out of a raw model response. Tolerant by design:
 * extracts a ```json fenced block or the first balanced {…} object, validates each op (dropping
 * malformed ones), and — if there is no usable envelope at all — returns the whole text as the
 * reply with no ops, so plain conversation still works.
 */
export function parseChatReply(raw: string): { reply: string; ops: BlueprintOp[] } {
  const text = raw.trim();
  const json = extractJson(text);
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === "object" && typeof (parsed as any).reply === "string") {
        const rawOps = Array.isArray((parsed as any).ops) ? (parsed as any).ops : [];
        const ops: BlueprintOp[] = [];
        for (const o of rawOps) {
          const r = opSchema.safeParse(o);
          if (r.success) ops.push(r.data as BlueprintOp);
        }
        return { reply: (parsed as any).reply, ops };
      }
    } catch {
      // fall through to plain-text fallback
    }
  }
  return { reply: text, ops: [] };
}

/** Find a JSON object in model output: prefer a fenced ```json block, else the first balanced
 *  {…} (brace-counting, string-aware so braces inside strings don't end it early). */
function extractJson(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1].trim() : text;
  const start = body.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return body.slice(start, i + 1);
  }
  return null;
}

// --- node manifest -------------------------------------------------------------------------------

/** The blueprint graph, interpreted loosely (the server otherwise treats it as opaque). */
export interface ChatGraphNode { id: string; type: string; data?: { label?: string; description?: string; cases?: string[] } }
export interface ChatGraphEdge { source: string; target: string; sourceHandle?: string | null }
export interface ChatGraph { nodes: ChatGraphNode[]; edges: ChatGraphEdge[] }

/**
 * A compact, id-bearing description of what's on the canvas, injected into the system prompt so the
 * model can target existing cards precisely ("rename the Fetch step", "add a check after n_a").
 * `selected` flags the cards the user currently has highlighted — what they likely mean by "this".
 */
export function buildManifest(graph: ChatGraph, selected: string[] = []): string {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  if (!nodes.length) return "The canvas is empty (only the Start node exists).";
  const sel = new Set(selected);

  const nodeLines = nodes.map(n => {
    const label = n.data?.label?.trim() || "(unnamed)";
    const desc = n.data?.description?.trim() ? ` desc: ${n.data.description.trim()}` : "";
    const cs = Array.isArray(n.data?.cases) && n.data!.cases!.length
      ? ` cases: [${n.data!.cases!.map((c, i) => `c${i}="${c}"`).join(", ")}, else]`
      : "";
    const star = sel.has(n.id) ? "  ← SELECTED" : "";
    return `- ${n.id} [${n.type}] "${label}"${desc}${cs}${star}`;
  });

  const edgeLines = edges.map(e => {
    const arrow = e.sourceHandle ? ` --${e.sourceHandle}--> ` : " --> ";
    return `- ${e.source}${arrow}${e.target}`;
  });

  // Spell out what the ← SELECTED markers mean: the model only sees a tag otherwise. Tie the user's
  // deictic words ("this", "here", that card) to the highlighted ids so "add a check after this" or
  // "rename this" lands on the right card without the user repeating its name.
  const selNodes = nodes.filter(n => sel.has(n.id));
  const selLine = selNodes.length
    ? "\n" + [
        `The user currently has ${selNodes.length === 1 ? "this card" : "these cards"} SELECTED: ` +
          selNodes.map(n => `${n.id} ("${n.data?.label?.trim() || "(unnamed)"}")`).join(", ") + ".",
        `When they say "this", "here", "that", "the selected one", "after this", etc., they mean ` +
          `the selected ${selNodes.length === 1 ? "card" : "cards"} unless they explicitly name a ` +
          `different card. Apply edits, additions, and connections relative to it.`,
      ].join("\n")
    : "";

  return [
    "Nodes (reference these exact ids):",
    ...nodeLines,
    ...(edgeLines.length ? ["Wires:", ...edgeLines] : []),
  ].join("\n") + selLine;
}
