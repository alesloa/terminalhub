// Prompt builder for the Prompt Builder modal. Condenses the /prompt-master skill into a system
// instruction, then appends the user's structured wizard inputs. The model returns ONLY the
// finished prompt (shown raw in a copyable field) — no commentary, no decoration, no fences.

export interface PromptBuilderInputs {
  idea: string; // required — what the prompt should make the target tool do
  targetTool: string; // required — which AI tool the prompt is written for
  outputFormat?: string; // shape / length / structure of the desired output
  constraints?: string; // musts, must-nots, scope boundaries
  audience?: string; // who reads the output, their level
}

const MAX_FIELD = 4_000; // keep each free-text field bounded so the request stays small

export const PROMPT_BUILDER_INSTRUCTIONS = [
  "You are a senior prompt engineer. Turn the request below into a single, production-ready",
  "prompt optimized for the named target tool, ready to paste as-is.",
  "",
  "Rules:",
  "- Tailor wording and structure to the target tool's known best practices.",
  "- Put the most critical constraints in the first third of the prompt.",
  "- Use strong signal words (MUST, NEVER) over weak ones (should, avoid).",
  "- For reasoning-native models (o1, o3, DeepSeek-R1, Qwen3-thinking) keep it short and do NOT",
  "  add 'think step by step' or other chain-of-thought scaffolding.",
  "- For agentic/coding tools (Claude Code, Cursor, Devin) include scope limits and explicit stop",
  "  conditions so the agent does not over-reach.",
  "- Do NOT use fabricated meta-techniques (Mixture of Experts, Tree/Graph of Thought).",
  "- Do NOT name the technique or framework you used.",
  "Output ONLY the finished prompt text. No preamble, no explanation, no surrounding quotes or",
  "code fences, no 'Target:' line.",
].join("\n");

const clip = (s: string): string => {
  const t = s.trim();
  return t.length > MAX_FIELD ? t.slice(0, MAX_FIELD) + "…(truncated)" : t;
};

/** Assemble the full message sent to the provider: instructions + the wizard's structured fields. */
export function buildPrompterPrompt(inp: PromptBuilderInputs): string {
  const lines = [
    PROMPT_BUILDER_INSTRUCTIONS,
    "",
    `Target tool: ${clip(inp.targetTool)}`,
    `Task: ${clip(inp.idea)}`,
  ];
  if (inp.outputFormat?.trim()) lines.push(`Output format: ${clip(inp.outputFormat)}`);
  if (inp.constraints?.trim()) lines.push(`Constraints: ${clip(inp.constraints)}`);
  if (inp.audience?.trim()) lines.push(`Audience: ${clip(inp.audience)}`);
  return lines.join("\n");
}

const MAX_SPEC = 16_000; // blueprint specs can be long (many steps + branches); keep them bounded

export const BLUEPRINT_INSTRUCTIONS = [
  "You are a senior prompt engineer. Below is a PROGRAM BLUEPRINT: an ordered, branching plan a",
  "user mapped out on a canvas. Turn it into a single, production-ready implementation prompt for",
  "the named target coding tool, ready to paste as-is.",
  "",
  "Rules:",
  "- Preserve EVERY step and EVERY branch (if-yes / if-no) exactly. Do NOT drop, merge, or reorder",
  "  logic, and do NOT invent steps the blueprint does not specify.",
  "- Make the control flow explicit and unambiguous for an autonomous coding agent.",
  "- Put the overall goal and the most critical constraints in the first third of the prompt.",
  "- Include clear scope limits and explicit stop conditions so the agent does not over-reach.",
  "- Use strong signal words (MUST, NEVER) over weak ones (should, avoid).",
  "- If a step is vague, keep it as a clear instruction the agent must implement faithfully — do not",
  "  silently guess missing detail.",
  "- Do NOT name the technique or framework you used.",
  "Output ONLY the finished prompt text. No preamble, no explanation, no surrounding quotes or code",
  "fences.",
].join("\n");

/** Wrap a serialized blueprint spec into the message sent to the provider for the Polish step. */
export function buildBlueprintPrompterPrompt(spec: string, targetTool: string): string {
  const s = spec.trim();
  const clippedSpec = s.length > MAX_SPEC ? s.slice(0, MAX_SPEC) + "\n…(truncated)" : s;
  return [
    BLUEPRINT_INSTRUCTIONS,
    "",
    `Target tool: ${clip(targetTool)}`,
    "Blueprint:",
    clippedSpec,
  ].join("\n");
}

export const CHAT_INSTRUCTIONS = [
  "You are the AI inside a Prompt Builder. Your one job is to help the user turn their idea into a",
  "clear, high-quality prompt they can hand to a coding agent. Everything you say should move them",
  "toward a finished, paste-ready prompt — you are not a general chatbot.",
  "",
  "The user builds their program visually as connected boxes — steps, conditions, loops, branches —",
  "on a canvas. That map (shown below as the current plan) is the skeleton of the prompt you are",
  "helping them write.",
  "",
  "- Help them build the prompt: ask what they are trying to build, fill the gaps, surface missing",
  "  steps, branches, and edge cases, and tighten the wording.",
  "- You can build the canvas FOR them: add steps, branches, and wires, rename or retype cards, or",
  "  remove them — by emitting ops in the output format described at the end.",
  "- Ground every suggestion in the current plan below when it is non-empty.",
  "- When they ask for it, produce or refine the actual prompt text for their target coding tool.",
  "- Be concise and concrete; prefer short, skimmable answers over essays.",
  "- Ask a clarifying question only when you are genuinely blocked.",
].join("\n");

// How the model edits the canvas: a JSON envelope it returns instead of plain prose. The web parses
// it (server/src/ai/chatOps.ts) and applies the ops to the React Flow graph. Placeholders below are
// intentionally not valid JSON so the contract reads as a template, not a literal to copy.
export const CHAT_OUTPUT_CONTRACT = [
  "EDITING THE CANVAS — OUTPUT FORMAT",
  "Whenever you add, change, connect, or remove steps, build it by returning ONLY a single JSON",
  "object (no prose, no markdown, no code fences) of exactly this shape:",
  '  { "reply": "<one short sentence for the chat>", "ops": [ <zero or more edits> ] }',
  '- "reply" is always present: what you would say in the chat bubble.',
  '- "ops" is the list of canvas edits to apply; use [] when you are only talking.',
  "Edit types (one object each):",
  '  { "op": "add", "tempId": "t1", "kind": "<kind>", "label": "...", "description": "..." }',
  '  { "op": "connect", "from": "<id-or-tempId>", "to": "<id-or-tempId>", "branch": "<handle>" }',
  '  { "op": "update", "id": "<id>", "label": "...", "description": "...", "kind": "<kind>", "cases": ["..."] }',
  '  { "op": "delete", "id": "<id>" }',
  '  { "op": "disconnect", "from": "<id>", "to": "<id>" }',
  "Node kinds: action, condition, loop, switch, parallel, try, param, group, end (never \"start\").",
  "Branch handles (only on forks): condition = yes | no; loop = body | done; try = ok | fail;",
  "  switch = c0, c1, … (one per case, in order) or else. Other kinds take no branch.",
  "Rules:",
  "- Reference cards already on the canvas by their EXACT id from the list above. Give each NEW node",
  "  a short tempId and connect it so it is never left floating.",
  "- To insert a step BETWEEN connected cards X and Y: add node N, disconnect X→Y, connect X→N,",
  "  connect N→Y.",
  '- For a switch, set its branches with "cases" on add/update, then connect each with branch "c0",',
  '  "c1", … or "else".',
  "- Only emit ops the user actually asked for. Never recreate the Start node. Keep the graph valid:",
  "  no self-links, no duplicate wires.",
].join("\n");

/** System instruction for the floating canvas chat: the helper persona + the live blueprint
 *  context (current plan, target tool, node manifest with ids) + the canvas-editing output contract,
 *  so replies stay grounded in what's on the canvas and can drive it. */
export function buildChatSystem(opts: { spec?: string; targetTool?: string; manifest?: string } = {}): string {
  const lines = [CHAT_INSTRUCTIONS];
  if (opts.targetTool?.trim()) lines.push("", `The blueprint targets this coding tool: ${clip(opts.targetTool)}.`);
  if (opts.spec?.trim()) {
    const s = opts.spec.trim();
    lines.push("", "Current blueprint plan (may be empty or partial):", s.length > MAX_SPEC ? s.slice(0, MAX_SPEC) + "\n…(truncated)" : s);
  }
  if (opts.manifest?.trim()) lines.push("", opts.manifest);
  lines.push("", CHAT_OUTPUT_CONTRACT);
  return lines.join("\n");
}
