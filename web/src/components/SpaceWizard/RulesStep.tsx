import type { SpaceConfig } from "../../api/types";

type ClaudeMd = SpaceConfig["claudeMd"];
type SeedTarget = SpaceConfig["seedTarget"];

const TARGETS: { value: SeedTarget; label: string }[] = [
  { value: "both", label: "AGENTS.md + CLAUDE.md" },
  { value: "AGENTS.md", label: "AGENTS.md only" },
  { value: "CLAUDE.md", label: "CLAUDE.md only" },
];

/** Wizard step: the rules text seeded into CLAUDE.md/AGENTS.md inside a managed block. Pin puts the
 *  block at the top, append at the bottom; either way it's replaced in place on re-seed and never
 *  touches the user's own text outside the markers. */
export function RulesStep({ claudeMd, seedTarget, onChange }: {
  claudeMd: ClaudeMd;
  seedTarget: SeedTarget;
  onChange: (patch: { claudeMd?: ClaudeMd; seedTarget?: SeedTarget }) => void;
}) {
  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <p className="text-sm text-muted">
        Content to seed into each workspace's agent rules file. Wrapped in a Terminal Hub-managed block —
        anything you hand-write outside it stays untouched.
      </p>
      <textarea value={claudeMd.content}
        onChange={(e) => onChange({ claudeMd: { ...claudeMd, content: e.target.value } })} spellCheck={false}
        placeholder={"e.g.\n- Use TDD for every change.\n- Prefer small, focused files."}
        className="flex-1 min-h-0 w-full px-3 py-2 bg-[#1c1c1c] border border-edge rounded text-sm leading-relaxed outline-none focus:border-accent resize-none" />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Placement</span>
          {(["pin", "append"] as const).map((m) => (
            <button key={m} onClick={() => onChange({ claudeMd: { ...claudeMd, mode: m } })}
              className={`px-3 py-1 rounded text-sm border ${claudeMd.mode === m ? "border-accent bg-accent/10 text-bright" : "border-edge text-muted hover:text-bright"}`}>
              {m === "pin" ? "Pin to top" : "Append to bottom"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="text-sm text-muted">Seed into</span>
          <select value={seedTarget} onChange={(e) => onChange({ seedTarget: e.target.value as SeedTarget })}
            className="px-2 py-1 bg-[#1c1c1c] border border-edge rounded text-sm outline-none focus:border-accent">
            {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
