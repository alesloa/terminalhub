import type { AppContext } from "../context.js";
import { createProvider } from "./providerAdapter.js";
import { createRegistry } from "./registry.js";
import { collectTools, enabledSkills } from "./skills/registry.js";
import { buildSystemPrompt } from "./knowledge/systemPrompt.js";
import { runCopilotTurn, type CopilotEvent } from "./agent.js";
import type { CopilotProvider, CopilotMessage, CopilotActor, ContentBlock, ProviderToolCall } from "./types.js";

// Which skills are active this turn (core is always on; optional skills if the user enabled them).
export function enabledCopilotSkillIds(app: AppContext): string[] {
  return enabledSkills(app).map((s) => s.id);
}

// One-line summary of configured skill accounts for the system prompt (so the model can route "check
// my Gmail" to the right mailbox). Only advertised while the email skill is enabled.
export function accountsSummary(app: AppContext): string | undefined {
  if (!app.store.getCopilotSkillState("email")?.enabled) return undefined;
  const email = app.store.listSkillAccounts("email");
  if (!email.length) return undefined;
  return `Email accounts: ${email.map((a) => `${a.label} (${a.provider})`).join(", ")}`;
}

// Pick the AiProvider that drives the copilot: the user's chosen default engine, else the global AI
// default, else the first enabled API provider. CLI engines can't do native tool-use, so they're
// rejected with a clear message rather than silently failing mid-turn.
export function resolveCopilotProvider(app: AppContext): { provider: CopilotProvider; providerId: string } | { error: string } {
  const settings = app.store.getCopilotSettings();
  const cfg = app.store.getAiConfig();
  const byId = (id: string | null) => (id ? cfg.providers.find((p) => p.id === id) : undefined);
  const p = byId(settings.defaultEngine)
    ?? byId(cfg.defaultProviderId)
    ?? cfg.providers.find((x) => x.enabled && (x.kind === "anthropic" || x.kind === "openai-compatible"));
  if (!p) return { error: "No AI engine configured. Add an Anthropic or OpenAI-compatible provider in Settings → AI." };
  if (p.kind === "cli") return { error: `"${p.label}" is a CLI engine; the Copilot needs an API engine (Anthropic or OpenAI-compatible). Pick one in Settings.` };
  return { provider: createProvider(p), providerId: p.id };
}

// Rehydrate a conversation's stored transcript into the canonical message form the loop expects.
export function loadHistory(app: AppContext, conversationId: string): CopilotMessage[] {
  return app.store.listCopilotMessages(conversationId).map((m) => ({
    role: m.role,
    content: safeBlocks(m.content),
  }));
}
function safeBlocks(raw: string): ContentBlock[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

const titleFrom = (text: string) => text.trim().split(/\s+/).slice(0, 7).join(" ").slice(0, 80);

// Run one turn end-to-end: load history, drive the loop, forward every event to `onEvent`, and
// persist the new messages (user + assistant + tool results) so the chat survives refresh. Returns
// the final assistant text. The provider is injected (resolved by the caller / mocked in tests).
export async function streamTurn(opts: {
  app: AppContext;
  provider: CopilotProvider;
  conversationId: string;
  userText: string;
  actor: CopilotActor;
  onEvent: (ev: CopilotEvent) => void;
  confirm?: (call: ProviderToolCall) => Promise<boolean>;
}): Promise<{ finalText: string }> {
  const { app, conversationId } = opts;
  const history = loadHistory(app, conversationId);
  const settings = app.store.getCopilotSettings();
  const enabled = enabledCopilotSkillIds(app);
  const tools = collectTools(app);                 // tools from every enabled skill
  const registry = createRegistry(tools);
  const system = buildSystemPrompt({ enabledSkillIds: enabled, tools, accountsSummary: accountsSummary(app) });

  // Persist the user message immediately so it shows even if the model errors.
  app.store.addCopilotMessage({ conversationId, role: "user", content: JSON.stringify([{ type: "text", text: opts.userText }]) });
  const conv = app.store.getCopilotConversation(conversationId);
  if (conv && !conv.title) app.store.updateCopilotConversation(conversationId, { title: titleFrom(opts.userText) });

  let finalText = "";
  for await (const ev of runCopilotTurn({
    provider: opts.provider, registry, system, history, userText: opts.userText,
    cctx: { app, settings, actor: opts.actor }, enabledSkillIds: enabled, confirm: opts.confirm,
  })) {
    opts.onEvent(ev);
    if (ev.type === "final") {
      finalText = ev.text;
      // Persist everything the loop produced after the (already-stored) user message.
      for (const m of ev.messages.slice(history.length + 1)) {
        app.store.addCopilotMessage({ conversationId, role: m.role, content: JSON.stringify(m.content) });
      }
    }
  }
  app.store.touchCopilotConversation(conversationId);
  return { finalText };
}
