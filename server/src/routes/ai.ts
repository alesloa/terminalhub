import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { AiError } from "../ai/complete.js";
import { DEFAULT_COMMIT_INSTRUCTIONS } from "../ai/commit.js";
import { DEFAULT_PR_INSTRUCTIONS } from "../ai/pr.js";

const providerSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["cli", "openai-compatible", "anthropic"]),
  label: z.string().min(1),
  enabled: z.boolean(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(), // omitted = keep the existing stored key (see controller.saveConfig)
  apiKeyEnv: z.string().optional(),
  command: z.array(z.string()).optional(),
});

export async function aiRoutes(app: FastifyInstance, ctx: AppContext) {
  const { ai } = ctx;

  app.get("/api/ai/providers", async () => ({
    providers: ai.listProviders(),
    defaultProviderId: ai.getConfig().defaultProviderId,
    commitPrompt: ai.getConfig().commitPrompt ?? null, // null = using the built-in default
    defaultCommitPrompt: DEFAULT_COMMIT_INSTRUCTIONS, // so the UI can show/reset to it
    prPrompt: ai.getConfig().prPrompt ?? null, // custom PR-description instructions; null = built-in default
    defaultPrPrompt: DEFAULT_PR_INSTRUCTIONS, // the built-in PR prompt, for display + "reset to default"
    detectedClis: ai.detectedClis(), // installed coding CLIs the "Add:" row can offer as providers
  }));

  app.put("/api/ai/providers", async (req, reply) => {
    const b = z.object({
      providers: z.array(providerSchema),
      defaultProviderId: z.string().nullable(),
      commitPrompt: z.string().optional(), // omitted = keep current; "" = reset to the built-in default
      prPrompt: z.string().optional(), // same semantics, for the PR-description prompt
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid ai config" });
    ai.saveConfig(b.data);
    return { ok: true };
  });

  app.post("/api/ai/commit-message", async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try {
      return { message: await ai.generateCommitMessage(b.data.path) };
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "generation failed" });
    }
  });

  // The FIRST commit's message for a brand-new repo: summarized from its top-level untracked files
  // (no staging), so the Initialize-repo dialog's ✨ never blocks on `git add -A` of a huge folder.
  app.post("/api/ai/initial-commit-message", async (req, reply) => {
    const b = z.object({ path: z.string().min(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try {
      return { message: await ai.generateInitialCommitMessage(b.data.path) };
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "generation failed" });
    }
  });

  // Generate a PR title + body for the current branch from its commits + changed files. `base`
  // (optional) is the merge target; omitted ⇒ the repo's default branch. Same AiError → 400 mapping
  // as commit-message generation (no provider, no base, no commits over the base).
  app.post("/api/ai/pr-description", async (req, reply) => {
    const b = z.object({ path: z.string().min(1), base: z.string().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "path required" });
    try {
      return await ai.generatePrDescription(b.data.path, b.data.base);
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "generation failed" });
    }
  });

  // List a provider's available models for the settings dropdown. `apiKey` (a just-typed, unsaved
  // key) is optional — when omitted the server uses the stored key for `id`, or the env-var fallback.
  app.post("/api/ai/models", async (req, reply) => {
    const b = z.object({
      id: z.string().optional(),
      kind: z.enum(["cli", "openai-compatible", "anthropic"]),
      label: z.string().optional(),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      apiKeyEnv: z.string().optional(),
      command: z.array(z.string()).optional(), // CLI providers: the argv, so the server finds its backing model API
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "invalid request" });
    try {
      return { models: await ai.listModels(b.data) };
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "failed to list models" });
    }
  });

  app.get("/api/ai/builder", async () => ai.builderInfo());

  app.post("/api/ai/build-prompt", async (req, reply) => {
    const b = z.object({
      inputs: z.object({
        idea: z.string().min(1),
        targetTool: z.string().min(1),
        outputFormat: z.string().optional(),
        constraints: z.string().optional(),
        audience: z.string().optional(),
      }),
      engineId: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "idea and targetTool are required" });
    try {
      return { prompt: await ai.buildPrompt(b.data.inputs, b.data.engineId) };
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "generation failed" });
    }
  });

  // Polish a program blueprint: the web canvas serializes its graph to a structured spec and posts
  // it here to turn into a finished implementation prompt for the target tool.
  app.post("/api/ai/build-prompt-from-blueprint", async (req, reply) => {
    const b = z.object({
      spec: z.string().min(1),
      targetTool: z.string().min(1),
      engineId: z.string().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "spec and targetTool are required" });
    try {
      return { prompt: await ai.buildBlueprintPrompt(b.data.spec, b.data.targetTool, b.data.engineId) };
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "generation failed" });
    }
  });

  // Multi-turn chat for the floating canvas assistant. The web sends the running transcript plus
  // the live blueprint context (current plan, target tool, the node graph, and the selection); the
  // server grounds the model in it and returns the reply plus any canvas ops the model emitted.
  app.post("/api/ai/chat", async (req, reply) => {
    const b = z.object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1),
      spec: z.string().optional(),
      targetTool: z.string().optional(),
      engineId: z.string().optional(),
      graph: z.object({ nodes: z.array(z.any()), edges: z.array(z.any()) }).passthrough().optional(),
      selected: z.array(z.string()).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "messages are required" });
    try {
      const { messages, ...ctx } = b.data;
      return await ai.chat(messages, ctx);
    } catch (err: any) {
      if (err instanceof AiError) return reply.code(400).send({ error: err.message });
      return reply.code(500).send({ error: err?.message ?? "chat failed" });
    }
  });
}
