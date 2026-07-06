import { copyText } from "../../lib/clipboard";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { PromptBuilderInputs } from "../../api/types";
import { useToasts } from "../../store/toasts";
import { AiProviderSettings } from "../Scm/AiProviderSettings";
import { BlueprintCanvas } from "./blueprint/BlueprintCanvas";

const EMPTY: PromptBuilderInputs = { idea: "", targetTool: "" };
type Mode = "choose" | "quick" | "blueprint";

export function PromptBuilderModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  // Engines + target tools reflect ONLY what the user actually has: usable configured providers
  // plus coding-agent CLIs detected on the host. Refetched whenever AI settings change.
  const { data } = useQuery({ queryKey: ["ai", "builder"], queryFn: () => api.ai.builder() });
  const engines = data?.engines ?? [];
  const targetTools = data?.targetTools ?? [];

  const [mode, setMode] = useState<Mode>("choose");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [inputs, setInputs] = useState<PromptBuilderInputs>(EMPTY);
  const [engineId, setEngineId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);

  // Seed the engine (and the target tool, which defaults to that engine's tool) once data lands,
  // and keep the engine valid if the available set changes (e.g. after editing settings).
  useEffect(() => {
    if (!data) return;
    setEngineId(prev => {
      const valid = prev && engines.some(e => e.id === prev) ? prev : data.defaultEngineId;
      const eng = engines.find(e => e.id === valid);
      // Keep the target only if it's still one of the user's real tools; else default to the
      // engine's tool. No free text — every target must map to something the user actually has.
      setInputs(i => {
        const keep = i.targetTool && targetTools.includes(i.targetTool);
        return keep ? i : { ...i, targetTool: eng?.tool ?? targetTools[0] ?? "" };
      });
      return valid;
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<PromptBuilderInputs>) => setInputs(i => ({ ...i, ...patch }));
  // Switching the engine retargets the prompt to that engine's tool (the common case).
  const onEngine = (id: string) => {
    setEngineId(id || null);
    const eng = engines.find(e => e.id === id);
    if (eng) set({ targetTool: eng.tool });
  };

  const gen = useMutation({
    mutationFn: () => api.ai.buildPrompt(inputs, engineId ?? undefined),
    onSuccess: d => { setResult(d.prompt); setStep(3); },
    onError: (e: Error) => push(e.message),
  });

  const copy = async () => {
    try { await copyText(result); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { push("Couldn't copy — select the text and copy manually"); }
  };

  const noEngines = !!data && engines.length === 0;
  const canGenerate = !!inputs.idea.trim() && !!inputs.targetTool.trim() && !!engineId && !gen.isPending;

  // The program-blueprint canvas is its own full-screen surface (the little modal is too small).
  if (mode === "blueprint") return <BlueprintCanvas onClose={onClose} onBack={() => setMode("choose")} />;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div onClick={e => e.stopPropagation()}
          className="w-[620px] max-w-full max-h-[86vh] flex flex-col bg-canvas border border-edge rounded-lg shadow-xl">

          {/* Header: title · build-with engine · settings cog · close */}
          <div className="flex items-center gap-2 px-4 h-12 shrink-0 border-b border-edge">
            <span className="text-sm font-semibold text-bright mr-auto">Prompt Builder</span>
            {mode === "quick" && <>
              <button onClick={() => setMode("choose")} title="Back" className="text-dim hover:text-fg text-xs mr-1">←</button>
              <span className="text-[10px] text-dim">build with</span>
              <select value={engineId ?? ""} onChange={e => onEngine(e.target.value)}
                title="The AI that writes the prompt (your installed CLIs + configured API keys)"
                className="max-w-[180px] px-2 py-1 text-xs bg-panel border border-edge rounded outline-none focus:border-blue-500 text-fg disabled:opacity-50"
                disabled={engines.length === 0}>
                {engines.length === 0 && <option value="">none available</option>}
                {engines.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </>}
            <button onClick={() => setSettingsOpen(true)} title="AI providers & API keys"
              className="w-7 h-7 flex items-center justify-center rounded bg-elevated hover:bg-edge text-muted hover:text-bright">
              <CogIcon />
            </button>
            <button onClick={onClose} title="Close" className="text-dim hover:text-fg px-1">✕</button>
          </div>

          {/* Step indicator (quick mode only) */}
          {mode === "quick" && (
            <div className="flex items-center justify-center gap-2 py-2.5 shrink-0 text-[11px] text-dim">
              <Dot on={step >= 1} /> Idea
              <span className="text-dim">→</span>
              <Dot on={step >= 2} /> Refine
              <span className="text-dim">→</span>
              <Dot on={step >= 3} /> Result
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
            {mode === "choose" && <ChooseScreen onPick={setMode} />}

            {mode === "quick" && noEngines && (
              <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                No AI engine found. Install a coding-agent CLI (<code>claude</code>, <code>codex</code>) — it'll
                show up here automatically — or open the <CogIcon className="inline w-3 h-3 -mt-0.5" /> settings to
                add an API key (OpenAI / Anthropic / Gemini / DeepSeek / Kimi).
              </div>
            )}

            {mode === "quick" && step === 1 && (
              <>
                <Field label="What do you want the prompt to do? (required)">
                  <textarea autoFocus value={inputs.idea} onChange={e => set({ idea: e.target.value })} rows={5}
                    placeholder="e.g. summarize a PDF into 5 punchy bullets for a busy exec" className={areaCls} />
                </Field>
                <Field label="Target tool — the AI this prompt is for">
                  <Combobox options={targetTools} value={inputs.targetTool}
                    onChange={v => set({ targetTool: v })} disabled={targetTools.length === 0}
                    placeholder={targetTools.length === 0 ? "add an AI in settings first" : "type to filter…"} />
                  <p className="mt-1 text-[10px] text-dim">
                    Only the AIs you actually have. Add an API key or install a CLI to get more.
                  </p>
                </Field>
              </>
            )}

            {mode === "quick" && step === 2 && (
              <>
                <p className="text-[11px] text-dim">All optional — fill what matters, leave the rest blank.</p>
                <Field label="Output format — shape, length, structure">
                  <input value={inputs.outputFormat ?? ""} onChange={e => set({ outputFormat: e.target.value })}
                    placeholder="e.g. 5 bullets, max 12 words each; JSON; a 200-word email" className={inputCls} />
                </Field>
                <Field label="Constraints — what it MUST / MUST NOT do, scope">
                  <textarea value={inputs.constraints ?? ""} onChange={e => set({ constraints: e.target.value })} rows={3}
                    placeholder="e.g. no jargon; cite sources; don't touch files outside /src" className={areaCls} />
                </Field>
                <Field label="Audience — who reads the output">
                  <input value={inputs.audience ?? ""} onChange={e => set({ audience: e.target.value })}
                    placeholder="e.g. non-technical execs; senior engineers" className={inputCls} />
                </Field>
              </>
            )}

            {mode === "quick" && step === 3 && (
              <Field label="Your prompt — select & copy, or use the button">
                <textarea value={result} readOnly rows={14}
                  className="w-full px-2 py-1.5 text-xs font-mono leading-snug bg-panel border border-edge rounded outline-none focus:border-blue-500 resize-y selection:bg-blue-500/40" />
              </Field>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-edge px-4 py-3 flex items-center justify-between gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded bg-elevated hover:bg-edge text-fg">Cancel</button>
            <div className="flex items-center gap-2">
              {mode === "quick" && step === 1 && (
                <button onClick={() => setStep(2)} disabled={!inputs.idea.trim() || !inputs.targetTool.trim()}
                  className="px-3 py-1.5 text-sm rounded bg-elevated hover:bg-edge text-bright disabled:opacity-40">Next →</button>
              )}
              {mode === "quick" && step === 2 && (
                <>
                  <button onClick={() => setStep(1)} className="px-3 py-1.5 text-sm rounded bg-elevated hover:bg-edge text-fg">← Back</button>
                  <button onClick={() => gen.mutate()} disabled={!canGenerate}
                    className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
                    {gen.isPending ? "Building…" : "Generate ⚡"}
                  </button>
                </>
              )}
              {mode === "quick" && step === 3 && (
                <>
                  <button onClick={() => setStep(2)} className="px-3 py-1.5 text-sm rounded bg-elevated hover:bg-edge text-fg">← Edit</button>
                  <button onClick={() => { setStep(1); setResult(""); set({ idea: "" }); }}
                    className="px-3 py-1.5 text-sm rounded bg-elevated hover:bg-edge text-fg">New</button>
                  <button onClick={copy} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white">
                    {copied ? "Copied ✓" : "Copy ⧉"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {settingsOpen && <AiProviderSettings onClose={() => { setSettingsOpen(false); qc.invalidateQueries({ queryKey: ["ai"] }); }} />}
    </>
  );
}

function Dot({ on }: { on: boolean }) {
  return <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-blue-400" : "bg-edge-strong"}`} />;
}

/** First screen: pick a quick one-shot prompt, or map out a whole program on the node canvas. */
function ChooseScreen({ onPick }: { onPick: (m: "quick" | "blueprint") => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-1">
      <button onClick={() => onPick("quick")}
        className="text-left rounded-lg border border-edge hover:border-blue-500/60 bg-panel p-4 transition-colors">
        <div className="text-sm font-semibold text-bright mb-1">Quick prompt</div>
        <p className="text-xs text-dim leading-snug">Turn a rough idea into one polished, paste-ready prompt. Three quick steps.</p>
      </button>
      <button onClick={() => onPick("blueprint")}
        className="text-left rounded-lg border border-edge hover:border-emerald-500/60 bg-panel p-4 transition-colors">
        <div className="text-sm font-semibold text-bright mb-1">
          Build a prompt <span className="text-[10px] text-emerald-400 align-middle">canvas</span>
        </div>
        <p className="text-xs text-dim leading-snug">
          Map your program as connected boxes with yes/no branches, then turn the whole flow into an
          implementation prompt for your coding agent.
        </p>
      </button>
    </div>
  );
}

/**
 * Type-to-filter combobox locked to a fixed option list. Typing only FILTERS — it never commits a
 * value that isn't in `options` (a target tool must be an AI the user actually has). Pick by click,
 * Enter on the highlighted row, or by typing an exact name and blurring; anything else reverts.
 */
function Combobox({ options, value, onChange, disabled, placeholder }:
  { options: string[]; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  // Resync the visible text when the committed value changes from outside (e.g. switching engine).
  useEffect(() => { setQuery(value); }, [value]);

  // The dropdown renders in a body portal with fixed positioning so the modal body's overflow:auto
  // can't clip it. Anchor it to the input and keep it glued there while the modal scrolls/resizes.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = wrapRef.current;
      if (el) { const r = el.getBoundingClientRect(); setRect({ left: r.left, top: r.bottom + 4, width: r.width }); }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  const q = query.trim().toLowerCase();
  // While the box still shows the committed value, list everything; once the user types, filter.
  const filtered = query === value ? options : options.filter(o => o.toLowerCase().includes(q));
  const commit = (v: string) => { onChange(v); setQuery(v); setOpen(false); };

  return (
    <div className="relative" ref={wrapRef}>
      <input value={query} disabled={disabled} placeholder={placeholder} className={inputCls}
        onFocus={e => { setOpen(true); setHi(0); e.currentTarget.select(); }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, filtered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && filtered[hi]) { e.preventDefault(); commit(filtered[hi]); }
          else if (e.key === "Escape") { setOpen(false); setQuery(value); }
        }}
        onBlur={() => {
          const exact = options.find(o => o.toLowerCase() === q);
          if (exact) commit(exact); else setQuery(value);
          setOpen(false);
        }} />
      {open && !disabled && rect && createPortal(
        <ul style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}
          className="z-[60] max-h-52 overflow-auto bg-panel border border-edge rounded shadow-xl">
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-dim">No match — pick one of your AIs</li>
          ) : filtered.map((o, i) => (
            <li key={o} onMouseDown={e => { e.preventDefault(); commit(o); }} onMouseEnter={() => setHi(i)}
              className={`px-2 py-1.5 text-sm cursor-pointer ${i === hi ? "bg-elevated text-bright" : "text-fg"}`}>
              {o}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] text-dim mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full px-2 py-1.5 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500";
const areaCls = "w-full px-2 py-1.5 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500 resize-y leading-snug";

function CogIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className || "w-4 h-4"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
