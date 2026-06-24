import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useCopilotSettings, usePatchCopilotSettings } from "../../hooks/useCopilot";

// Compact engine switcher in the Copilot header. The Copilot resolves its provider server-side from
// settings.defaultEngine, so picking here just patches that setting — no per-message plumbing. Only
// API engines (Anthropic / OpenAI-compatible) can drive the Copilot, so CLI providers are filtered
// out (they're configured in the same AI Providers list the commit generator uses).
export function EnginePicker() {
  const settings = useCopilotSettings();
  const patch = usePatchCopilotSettings();
  const providers = useQuery({ queryKey: ["ai", "providers"], queryFn: () => api.ai.providers() });
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const engines = (providers.data?.providers ?? []).filter((p) => p.enabled && (p.kind === "anthropic" || p.kind === "openai-compatible"));
  const current = settings.data?.defaultEngine ? engines.find((e) => e.id === settings.data!.defaultEngine) : undefined;
  const label = current ? current.label : "Auto engine";

  const choose = (id: string | null) => { patch.mutate({ defaultEngine: id }); setOpen(false); };

  return (
    <div ref={wrap} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((v) => !v)} title="Pick the AI engine"
        className="-mt-0.5 flex items-center gap-1 text-[10px] text-dim hover:text-fg">
        <span className="max-w-[140px] truncate">{label}</span>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`transition-transform ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-10 min-w-[180px] rounded-lg border border-edge bg-elevated p-1 shadow-xl">
          <MenuItem active={!settings.data?.defaultEngine} onClick={() => choose(null)} label="Auto" sub="Your default API engine" />
          {engines.map((e) => (
            <MenuItem key={e.id} active={settings.data?.defaultEngine === e.id} onClick={() => choose(e.id)}
              label={e.label} sub={e.model || (e.kind === "anthropic" ? "Anthropic" : "OpenAI-compatible")} />
          ))}
          {engines.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-dim leading-4">No API engine configured. Add an Anthropic or OpenAI-compatible provider in the AI provider settings.</div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub: string }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${active ? "bg-blue-600/15 text-bright" : "text-muted hover:bg-surface/70 hover:text-fg"}`}>
      <span className="min-w-0">
        <span className="block truncate">{label}</span>
        <span className="block truncate text-[10px] text-dim">{sub}</span>
      </span>
      {active && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="shrink-0 text-blue-400"><path d="M20 6 9 17l-5-5" /></svg>}
    </button>
  );
}
