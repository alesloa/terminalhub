import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { AiProvider, AiProviderKind, AiProviderPublic } from "../../api/types";
import { useToasts } from "../../store/toasts";

/** A loaded provider plus the new secret the user is typing (never populated from the server). */
type Draft = AiProviderPublic & { newKey: string };

const KIND_LABEL: Record<AiProviderKind, string> = {
  cli: "CLI",
  "openai-compatible": "OpenAI-compatible",
  anthropic: "Anthropic API",
};

/**
 * API presets only — the CLI add-buttons come from server detection (only CLIs actually on $PATH).
 * Each API kind posts to a chat endpoint with a user-supplied key (or an env-var fallback). No model
 * is pre-filled — the user picks one from the fetched dropdown (the server refuses to guess).
 */
const PRESETS: { label: string; make: () => Draft }[] = [
  { label: "OpenAI", make: () => mk({ kind: "openai-compatible", label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" }) },
  { label: "Anthropic (API)", make: () => mk({ kind: "anthropic", label: "Anthropic (API)", baseUrl: "https://api.anthropic.com", apiKeyEnv: "ANTHROPIC_API_KEY" }) },
  // Gemini hidden by request — leave commented out rather than deleted so it's a one-line restore.
  // { label: "Gemini", make: () => mk({ kind: "openai-compatible", label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKeyEnv: "GEMINI_API_KEY" }) },
  { label: "DeepSeek", make: () => mk({ kind: "openai-compatible", label: "DeepSeek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY" }) },
  { label: "Kimi (Moonshot)", make: () => mk({ kind: "openai-compatible", label: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.ai/v1", apiKeyEnv: "MOONSHOT_API_KEY" }) },
  { label: "OpenRouter", make: () => mk({ kind: "openai-compatible", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" }) },
];

function mk(p: Partial<AiProvider> & { kind: AiProviderKind; label: string }): Draft {
  return { id: crypto.randomUUID(), enabled: true, apiKeySet: false, apiKeyFromEnv: false, newKey: "", ...p };
}

/** Provider identity for dedup: CLI binary, or kind + API base URL (trailing slash ignored). */
function sigOf(p: { kind: AiProviderKind; command?: string[]; baseUrl?: string }): string {
  return p.kind === "cli" ? `cli:${p.command?.[0] ?? ""}` : `${p.kind}:${(p.baseUrl ?? "").replace(/\/+$/, "")}`;
}

export function AiProviderSettings({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const { data } = useQuery({ queryKey: ["ai", "providers"], queryFn: () => api.ai.providers() });

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null); // commit-message instructions
  const [prPrompt, setPrPrompt] = useState<string | null>(null); // PR-description instructions
  useEffect(() => {
    if (data && drafts === null) {
      setDrafts(data.providers.map(p => ({ ...p, newKey: "" })));
      setDefaultId(data.defaultProviderId);
      setPrompt(data.commitPrompt ?? data.defaultCommitPrompt);
      setPrPrompt(data.prPrompt ?? data.defaultPrPrompt);
    }
  }, [data, drafts]);

  const update = (id: string, patch: Partial<Draft>) =>
    setDrafts(ds => (ds ?? []).map(d => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) =>
    setDrafts(ds => (ds ?? []).filter(d => d.id !== id));
  const add = (make: () => Draft) =>
    setDrafts(ds => [...(ds ?? []), make()]);

  const save = useMutation({
    mutationFn: () => {
      const providers: AiProvider[] = (drafts ?? []).map(({ apiKeySet, apiKeyFromEnv, newKey, ...rest }) =>
        newKey ? { ...rest, apiKey: newKey } : rest);
      // Send "" when a textarea still equals the built-in default (so it tracks future
      // default changes); otherwise persist the custom instructions verbatim.
      const cp = prompt == null ? undefined : (prompt === (data?.defaultCommitPrompt ?? "") ? "" : prompt);
      const pp = prPrompt == null ? undefined : (prPrompt === (data?.defaultPrPrompt ?? "") ? "" : prPrompt);
      return api.ai.saveProviders(providers, defaultId, cp, pp);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai"] }); onClose(); },
    onError: (e: Error) => push(e.message),
  });

  const list = drafts ?? [];
  // Hide a preset/detected-CLI once an equivalent provider exists. Identity = kind + the thing that
  // makes it that provider (CLI binary / API base URL), so renaming the label won't make a duplicate
  // reappear. CLI add-buttons are the installed CLIs the server detected on $PATH.
  const usedSigs = new Set(list.map(sigOf));
  // Gemini hidden by request — drop its detected-CLI add-button too (UI-only; detection is untouched).
  const cliAdds = (data?.detectedClis ?? []).filter(c => !usedSigs.has(`cli:${c.command[0]}`) && c.command[0] !== "gemini");
  const availablePresets = PRESETS.filter(p => !usedSigs.has(sigOf(p.make())));
  const nothingToAdd = cliAdds.length === 0 && availablePresets.length === 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="w-[640px] max-w-full max-h-[82vh] flex flex-col bg-canvas border border-edge rounded-lg shadow-xl">
        <div className="flex items-center justify-between px-4 h-11 shrink-0 border-b border-edge">
          <span className="text-sm text-fg">AI Providers</span>
          <button onClick={onClose} className="text-dim hover:text-fg">✕</button>
        </div>

        <div className="px-4 py-3 text-xs text-dim shrink-0">
          Used to generate commit messages. The active provider is the default (if enabled), else the
          first enabled one. A typed key takes precedence over its env-var fallback.
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 pb-3 space-y-3">
          {list.map(d => (
            <ProviderCard key={d.id} d={d} isDefault={defaultId === d.id}
              onDefault={() => setDefaultId(d.id)} onChange={patch => update(d.id, patch)} onRemove={() => remove(d.id)} />
          ))}
          {list.length === 0 && <div className="text-xs text-dim py-4 text-center">No providers yet. Add one below.</div>}

          <div className="border border-edge rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg">Commit message prompt</span>
              <button onClick={() => setPrompt(data?.defaultCommitPrompt ?? "")}
                className="text-[11px] text-dim hover:text-fg">Reset to default</button>
            </div>
            <p className="text-[11px] text-dim">
              Instructions sent to the model. The staged file list and diff are appended automatically.
            </p>
            <textarea value={prompt ?? ""} onChange={e => setPrompt(e.target.value)} rows={8}
              placeholder="Loading…"
              className="w-full px-2 py-1.5 text-xs font-mono leading-snug bg-panel border border-edge rounded outline-none focus:border-blue-500 resize-y" />
          </div>

          <div className="border border-edge rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg">Pull request prompt</span>
              <button onClick={() => setPrPrompt(data?.defaultPrPrompt ?? "")}
                className="text-[11px] text-dim hover:text-fg">Reset to default</button>
            </div>
            <p className="text-[11px] text-dim">
              Instructions for ✦ Generate in the Create Pull Request dialog. The branch's commits and
              changed-file list are appended automatically.
            </p>
            <textarea value={prPrompt ?? ""} onChange={e => setPrPrompt(e.target.value)} rows={8}
              placeholder="Loading…"
              className="w-full px-2 py-1.5 text-xs font-mono leading-snug bg-panel border border-edge rounded outline-none focus:border-blue-500 resize-y" />
          </div>
        </div>

        <div className="shrink-0 border-t border-edge px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-dim mr-1">Add:</span>
            {cliAdds.map(c => (
              <button key={c.id} onClick={() => add(() => mk({ kind: "cli", label: c.label, command: c.command }))}
                className="px-2 py-1 text-xs rounded bg-elevated hover:bg-edge text-fg border border-edge-strong">
                + {c.label}
              </button>
            ))}
            {availablePresets.map(p => (
              <button key={p.label} onClick={() => add(p.make)}
                className="px-2 py-1 text-xs rounded bg-elevated hover:bg-edge text-fg border border-edge-strong">
                + {p.label}
              </button>
            ))}
            {nothingToAdd && <span className="text-[11px] text-dim">all providers added</span>}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-elevated hover:bg-edge text-fg">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ d, isDefault, onDefault, onChange, onRemove }:
  { d: Draft; isDefault: boolean; onDefault: () => void; onChange: (patch: Partial<Draft>) => void; onRemove: () => void }) {
  const push = useToasts(s => s.push);
  const isCli = d.kind === "cli";
  const needsModel = !isCli && d.enabled && !d.model?.trim();
  const hasKey = !!d.newKey || d.apiKeySet || d.apiKeyFromEnv;

  // Models fetched via "refresh" (null = not fetched yet this open). The dropdown always also keeps
  // the currently-saved model as an option, so a prior pick stays selected before any refresh.
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const fetched = models ?? [];

  const refreshModels = async () => {
    setLoadingModels(true);
    try {
      const r = await api.ai.models({
        id: d.id, kind: d.kind, label: d.label, baseUrl: d.baseUrl,
        apiKey: d.newKey || undefined, // a just-typed key the server hasn't stored yet
        apiKeyEnv: d.apiKeyEnv,
        command: d.command, // CLI: lets the server find the CLI's backing model API
      });
      setModels(r.models);
      if (!r.models.length) push(`${d.label}: no models returned`);
    } catch (e) {
      push((e as Error).message);
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <div className="border border-edge rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={d.enabled} onChange={e => onChange({ enabled: e.target.checked })} title="Enabled" />
        <input value={d.label} onChange={e => onChange({ label: e.target.value })} placeholder="Label"
          autoComplete="off" data-1p-ignore data-lpignore="true"
          className="flex-1 min-w-0 px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
        <span className="text-[10px] text-dim shrink-0">{KIND_LABEL[d.kind]}</span>
        <label className="flex items-center gap-1 text-[11px] text-dim shrink-0" title="Use as the default provider">
          <input type="radio" name="ai-default" checked={isDefault} onChange={onDefault} />
          default
        </label>
        <button onClick={onRemove} title="Remove" className="text-dim hover:text-red-300 shrink-0">✕</button>
      </div>

      {isCli ? (
        <>
          <Field label="Command (argv — the prompt is delivered automatically)">
            <input value={(d.command ?? []).join(" ")} onChange={e => onChange({ command: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [] })}
              placeholder="claude -p" autoComplete="off" data-1p-ignore data-lpignore="true" className={inputCls} />
          </Field>
          <Field label="Model (optional — blank uses the CLI's own default)">
            {/* CLIs can't list their own models, so ↻ pulls the real list from the backing provider's
                API (using a key from below, an env var, or a matching API provider) — else type it. */}
            <ModelField model={d.model} onModel={m => onChange({ model: m })} models={fetched}
              loading={loadingModels} onRefresh={refreshModels} refreshDisabled={loadingModels}
              refreshTitle="Fetch this CLI's models from its provider API"
              emptyLabel="CLI default" emptyDisabled={false} invalid={false} />
          </Field>
          <details>
            <summary className="text-[11px] text-dim cursor-pointer hover:text-fg select-none">Advanced</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Model id (type manually)">
                <input value={d.model ?? ""} onChange={e => onChange({ model: e.target.value })} placeholder="e.g. sonnet, gpt-5"
                  autoComplete="off" data-1p-ignore data-lpignore="true" className={inputCls} />
              </Field>
              <Field label="Model-list API key (optional)">
                <input type="password" value={d.newKey} onChange={e => onChange({ newKey: e.target.value })}
                  autoComplete="new-password" name={`tr-key-${d.id}`} data-1p-ignore data-lpignore="true" data-form-type="other"
                  placeholder={d.apiKeyFromEnv ? `using $${d.apiKeyEnv}` : d.apiKeySet ? "•••••• stored" : "only used to list models"} className={inputCls} />
              </Field>
              <Field label="…or env var">
                <input value={d.apiKeyEnv ?? ""} onChange={e => onChange({ apiKeyEnv: e.target.value })} placeholder="ANTHROPIC_API_KEY"
                  autoComplete="off" data-1p-ignore data-lpignore="true" className={inputCls} />
              </Field>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="API key">
              {/* type=password masks the secret; autoComplete=new-password + the ignore flags stop
                  Chrome/1Password/LastPass from treating this card as a login form — that login
                  heuristic was autofilling the saved email into Model and a password into this field. */}
              <input type="password" value={d.newKey} onChange={e => onChange({ newKey: e.target.value })}
                autoComplete="new-password" name={`tr-key-${d.id}`} data-1p-ignore data-lpignore="true" data-form-type="other"
                placeholder={d.apiKeyFromEnv ? `using $${d.apiKeyEnv}` : d.apiKeySet ? "•••••• stored" : "paste API key"} className={inputCls} />
            </Field>
            <Field label={`Model${needsModel ? " (required)" : ""}`}>
              <ModelField model={d.model} onModel={m => onChange({ model: m })} models={fetched}
                loading={loadingModels} onRefresh={refreshModels} refreshDisabled={!hasKey || loadingModels}
                refreshTitle="Fetch available models with this API key"
                emptyLabel={hasKey ? "↻ refresh to load models" : "enter API key first"}
                emptyDisabled={true} invalid={needsModel} />
            </Field>
          </div>

          <details>
            <summary className="text-[11px] text-dim cursor-pointer hover:text-fg select-none">Advanced</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Base URL">
                <input value={d.baseUrl ?? ""} onChange={e => onChange({ baseUrl: e.target.value })} placeholder="https://…"
                  autoComplete="off" data-1p-ignore data-lpignore="true" className={inputCls} />
              </Field>
              <Field label="Model id (type manually)">
                <input value={d.model ?? ""} onChange={e => onChange({ model: e.target.value })} placeholder="e.g. kimi-k2-0905-preview"
                  autoComplete="off" data-1p-ignore data-lpignore="true" className={inputCls} />
              </Field>
              <Field label="API key env var (fallback)">
                <input value={d.apiKeyEnv ?? ""} onChange={e => onChange({ apiKeyEnv: e.target.value })} placeholder="MOONSHOT_API_KEY"
                  autoComplete="off" data-1p-ignore data-lpignore="true" className={inputCls} />
              </Field>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

/** Model picker shared by CLI + API cards: a <select> (never a text input, so the browser can't
 *  autofill it with an email) over the fetched models plus the current value, and a ↻ refresh button. */
function ModelField({ model, onModel, models, loading, onRefresh, refreshDisabled, refreshTitle, emptyLabel, emptyDisabled, invalid }: {
  model?: string; onModel: (m: string) => void;
  models: string[]; loading: boolean; onRefresh: () => void; refreshDisabled: boolean; refreshTitle: string;
  emptyLabel: string; emptyDisabled: boolean; invalid: boolean;
}) {
  const options = model && !models.includes(model) ? [model, ...models] : models;
  return (
    <div className="flex gap-1.5">
      <select value={model ?? ""} onChange={e => onModel(e.target.value)}
        className={`${inputCls} ${invalid ? "border-amber-500/60" : ""}`}>
        <option value="" disabled={emptyDisabled}>{emptyLabel}</option>
        {options.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <button type="button" onClick={onRefresh} disabled={refreshDisabled} title={refreshTitle}
        className="shrink-0 px-2 rounded bg-elevated hover:bg-edge text-fg border border-edge-strong disabled:opacity-40">
        {loading ? "…" : "↻"}
      </button>
    </div>
  );
}

const inputCls = "w-full px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-dim mb-0.5">{label}</span>
      {children}
    </label>
  );
}
