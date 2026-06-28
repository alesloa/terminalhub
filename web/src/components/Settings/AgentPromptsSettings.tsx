import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Section } from "./controls";

// The "Agent Prompts" tab. The per-agent GLOBAL system prompts (agent id → text) live server-side as a
// JSON blob (settings.agentSystemPrompts), so this tab saves them on its own button — separate from the
// modal's scalar "Save Settings". A workspace cog and the New Terminal field layer on top of these at
// launch (global ⊕ workspace ⊕ terminal). See agents/systemPrompt.ts.
export function AgentPromptsSettings() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: api.listAgents });

  const stored = settings?.agentSystemPrompts ?? {};
  // Draft map, seeded from the stored prompts; re-seeded whenever the stored blob changes and we're not
  // mid-edit (dirty), so an external change doesn't clobber what the user is typing.
  const [draft, setDraft] = useState<Record<string, string>>(stored);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setDraft(stored); }, [settings, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    // Strip empty values so a cleared prompt drops out of the blob rather than lingering.
    mutationFn: () => api.updateSettings({
      agentSystemPrompts: Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim())),
    }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ["settings"] }); },
  });

  const installed = (agents?.builtin ?? []).filter(a => a.installed);
  const set = (id: string, text: string) => { setDirty(true); setDraft(d => ({ ...d, [id]: text })); };

  return (
    <div className="space-y-6">
      <Section title="Global system prompts">
        <div className="text-xs text-dim">
          A base system prompt per detected agent — instructions, persona, or context every launch of that
          agent starts with. A workspace can append to or replace it (its cog), and each New Terminal can
          layer on a one-off message. Claude takes it via <code>--append-system-prompt</code>; the others
          via the instruction file they read (<code>AGENTS.md</code>, <code>.cursor/rules</code>,{" "}
          <code>GEMINI.md</code>) written into the workspace folder at launch.
        </div>

        {installed.length === 0 && (
          <div className="text-sm text-dim">No agent CLIs detected on $PATH.</div>
        )}

        {installed.map(a => (
          <div key={a.id} className="space-y-1.5" data-setting-id={`agent-prompt-${a.id}`}>
            <div className="flex items-center gap-2">
              <img src={`/agents/${a.id}.svg`} alt="" className="h-5 w-5 shrink-0 object-contain" />
              <span className="text-sm text-bright">{a.name}</span>
            </div>
            <textarea
              value={draft[a.id] ?? ""}
              onChange={e => set(a.id, e.target.value)}
              rows={4}
              placeholder={`System prompt for every ${a.name} session…`}
              className="w-full rounded border border-edge bg-canvas px-3 py-2 text-sm text-bright outline-none focus:border-blue-500 resize-y"
            />
          </div>
        ))}
      </Section>

      <div className="flex justify-end">
        <button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
          {save.isPending ? "Saving…" : "Save prompts"}
        </button>
      </div>
    </div>
  );
}
