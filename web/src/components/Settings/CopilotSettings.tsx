import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useCopilotSettings, usePatchCopilotSettings } from "../../hooks/useCopilot";
import type { CopilotOrbPosition, CopilotReportChannel } from "../../api/types";

const ORB_CORNERS: { id: CopilotOrbPosition; label: string }[] = [
  { id: "top-left", label: "Top left" },
  { id: "top-right", label: "Top right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "bottom-right", label: "Bottom right" },
];
const CHANNELS: { id: CopilotReportChannel; label: string; hint: string }[] = [
  { id: "toast", label: "In-app", hint: "Toast + notification center" },
  { id: "voice", label: "Voice", hint: "Read the report aloud" },
  { id: "pushover", label: "Pushover", hint: "Push to your phone (needs keys in Voice & Speech)" },
];

// The Copilot tab of Settings. Copilot settings live server-side (a JSON blob), so every control
// applies live via PATCH /api/copilot/settings — there's no Save button on this tab. The engine list
// reuses the AI providers the rest of the app uses; only API engines (Anthropic / OpenAI-compatible)
// can drive the Copilot, so CLI providers are filtered out.
export function CopilotSettings() {
  const settings = useCopilotSettings();
  const patch = usePatchCopilotSettings();
  const providers = useQuery({ queryKey: ["ai", "providers"], queryFn: () => api.ai.providers() });

  const s = settings.data;
  if (!s) return <div className="text-sm text-dim">loading…</div>;

  const engines = (providers.data?.providers ?? []).filter((p) => p.enabled && (p.kind === "anthropic" || p.kind === "openai-compatible"));
  const toggleChannel = (id: CopilotReportChannel, on: boolean) => {
    const next = on ? Array.from(new Set([...s.reportChannels, id])) : s.reportChannels.filter((c) => c !== id);
    patch.mutate({ reportChannels: next });
  };

  return (
    <div className="space-y-8">
      <Section title="Copilot">
        <Toggle title="Enable Copilot" hint="The in-app AI assistant (orb + launcher tile). Off hides it everywhere."
          checked={s.enabled} onChange={(on) => patch.mutate({ enabled: on })} />

        <Row title="Engine" hint={engines.length ? "Which AI provider answers. Auto picks your default API engine." : "No API engine yet — add an Anthropic or OpenAI-compatible provider in the AI settings."}>
          <select value={s.defaultEngine ?? ""} onChange={(e) => patch.mutate({ defaultEngine: e.target.value || null })}
            className="w-44 rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500">
            <option value="">Auto</option>
            {engines.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Row>

        <Toggle title="Confirm risky actions" hint="Ask before anything that types into a terminal. Strongly recommended."
          checked={s.confirmDangerous} onChange={(on) => patch.mutate({ confirmDangerous: on })} />
      </Section>

      <Section title="Canvas orb">
        <Toggle title="Show the orb" hint="A floating spark on the canvas that opens the Copilot."
          checked={s.orbEnabled} onChange={(on) => patch.mutate({ orbEnabled: on })} />
        <Row title="Orb corner" hint="Where the orb sits on the canvas.">
          <div className="grid grid-cols-2 gap-1">
            {ORB_CORNERS.map((c) => (
              <Segment key={c.id} active={s.orbPosition === c.id} onClick={() => patch.mutate({ orbPosition: c.id })}>{c.label}</Segment>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Loop reports">
        <div className="text-xs text-dim">How scheduled loops report back when they have something to tell you.</div>
        {CHANNELS.map((c) => (
          <Toggle key={c.id} title={c.label} hint={c.hint}
            checked={s.reportChannels.includes(c.id)} onChange={(on) => toggleChannel(c.id, on)} />
        ))}
      </Section>
    </div>
  );
}

// Local copies of the SettingsModal helpers (kept here so this panel is a self-contained file and
// SettingsModal stays under the 1000-line cap). Match the parent's look exactly.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-dim">{title}</h2>
      {children}
    </section>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-fg">{title}</div>
        {hint && <div className="text-xs text-dim">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block text-fg">{title}</span>
        <span className="block text-xs text-dim">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-blue-500" />
    </label>
  );
}

function Segment({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick}
      className={`min-w-20 rounded px-2 py-1 text-xs ${active ? "bg-edge-strong text-bright" : "text-dim hover:text-fg"}`}>
      {children}
    </button>
  );
}
