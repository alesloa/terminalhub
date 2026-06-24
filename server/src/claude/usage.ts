import { promises as fs } from "node:fs";

// Token + cost accounting for a single session transcript. Ported verbatim from the
// claude-session-explorer sessionUsageService so the numbers match the extension exactly.
// Only Claude assistant turns carry a `usage` block, so Codex transcripts produce zeros.

/**
 * Per-model price in USD per 1M tokens. Anthropic pricing model:
 *   - Cache write (5-min TTL)  = 1.25× base input
 *   - Cache write (1-hour TTL) = 2.0×  base input  ← Claude Code's default
 *   - Cache read               = 0.1×  base input
 */
interface ModelPricing {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

function priceFor(input: number, output: number): ModelPricing {
  return { input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2.0, cacheRead: input * 0.1 };
}

/* Pricing per 1M tokens (source: claude.com/pricing, verified 2026-04).
 * Note: Opus 4.6 / 4.7 dropped to $5/$25 from the original Opus 4's $15/$75. */
const PRICING: Record<string, ModelPricing> = {
  // Claude 4 / 4.x family
  "claude-opus-4-7": priceFor(5, 25),
  "claude-opus-4-6": priceFor(5, 25),
  "claude-opus-4": priceFor(15, 75),
  "claude-sonnet-4-6": priceFor(3, 15),
  "claude-sonnet-4-5": priceFor(3, 15),
  "claude-sonnet-4": priceFor(3, 15),
  "claude-haiku-4-5": priceFor(1, 5),
  "claude-haiku-4": priceFor(1, 5),
  // Claude 3.x
  "claude-3-5-sonnet": priceFor(3, 15),
  "claude-3-5-haiku": priceFor(1, 5),
  "claude-3-opus": priceFor(15, 75),
};

/** Best-match pricing lookup — finds the longest matching prefix. */
function findPricing(model: string): ModelPricing | undefined {
  const key = model.toLowerCase();
  if (PRICING[key]) return PRICING[key];
  let best: { len: number; price: ModelPricing } | undefined;
  for (const [k, v] of Object.entries(PRICING)) {
    if (key.startsWith(k) && (!best || k.length > best.len)) best = { len: k.length, price: v };
  }
  return best?.price;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  messageCount: number;
  models: Record<string, number>;
  /** Per-model token breakdown for debugging. */
  perModel: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }>;
}

export async function computeSessionUsage(jsonlPath: string): Promise<SessionUsage> {
  const usage: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    estimatedCostUSD: 0,
    messageCount: 0,
    models: {},
    perModel: {},
  };

  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath, "utf-8");
  } catch {
    return usage;
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const u = msg.usage as Record<string, unknown> | undefined;
    if (!u) continue;

    const inTok = (u.input_tokens as number) || 0;
    const outTok = (u.output_tokens as number) || 0;
    const cacheRead = (u.cache_read_input_tokens as number) || 0;

    // Prefer the split 5m/1h breakdown; fall back to the flat cache_creation_input_tokens.
    const cacheCreation = u.cache_creation as Record<string, number> | undefined;
    let cacheWrite5m = 0;
    let cacheWrite1h = 0;
    if (cacheCreation) {
      cacheWrite5m = cacheCreation.ephemeral_5m_input_tokens || 0;
      cacheWrite1h = cacheCreation.ephemeral_1h_input_tokens || 0;
    } else {
      cacheWrite5m = (u.cache_creation_input_tokens as number) || 0; // no breakdown — assume 5m
    }

    usage.inputTokens += inTok;
    usage.outputTokens += outTok;
    usage.cacheWrite5mTokens += cacheWrite5m;
    usage.cacheWrite1hTokens += cacheWrite1h;
    usage.cacheReadTokens += cacheRead;
    usage.messageCount += 1;

    const model = typeof msg.model === "string" ? msg.model : "unknown";
    usage.models[model] = (usage.models[model] || 0) + 1;

    const price = findPricing(model);
    let turnCost = 0;
    if (price) {
      turnCost =
        (inTok * price.input +
          outTok * price.output +
          cacheWrite5m * price.cacheWrite5m +
          cacheWrite1h * price.cacheWrite1h +
          cacheRead * price.cacheRead) / 1_000_000;
      usage.estimatedCostUSD += turnCost;
    }

    if (!usage.perModel[model]) {
      usage.perModel[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    }
    usage.perModel[model].input += inTok;
    usage.perModel[model].output += outTok;
    usage.perModel[model].cacheRead += cacheRead;
    usage.perModel[model].cacheWrite += cacheWrite5m + cacheWrite1h;
    usage.perModel[model].cost += turnCost;
  }

  usage.totalTokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheWrite5mTokens +
    usage.cacheWrite1hTokens +
    usage.cacheReadTokens;
  return usage;
}
