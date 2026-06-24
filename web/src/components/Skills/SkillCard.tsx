import type { InstalledSkill } from "../../api/types";

/** One installed skill: name + description, an enable switch, an update arrow, and delete. */
export function SkillCard({ skill, updateAvailable, busy, onView, onToggleEnabled, onUpdate, onDelete }: {
  skill: InstalledSkill;
  updateAvailable: boolean | null;
  busy: boolean;
  onView: () => void;
  onToggleEnabled: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`group px-3 py-2 border-b border-surface flex items-start gap-2 ${skill.enabled ? "" : "opacity-50"}`}>
      <button onClick={onView} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-fg truncate">{skill.displayName}</span>
          {updateAvailable && <span title="Update available" className="text-amber-400 text-[10px] leading-none">●</span>}
          {skill.scope === "global" && <span title="Global skill" className="text-[9px] text-dim border border-edge rounded px-1 leading-[14px]">G</span>}
        </div>
        {skill.description && <div className="text-[11px] text-dim truncate mt-0.5">{skill.description}</div>}
        {skill.sourceUrl && <div className="text-[10px] text-dim truncate">{skill.sourceUrl}</div>}
      </button>

      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        {updateAvailable && (
          <button onClick={onUpdate} disabled={busy} title="Update to latest"
            className="text-amber-400 hover:text-amber-300 text-xs leading-none disabled:opacity-40">↑</button>
        )}
        <button onClick={onToggleEnabled} disabled={busy} title={skill.enabled ? "Disable" : "Enable"}
          className="disabled:opacity-40">
          <span className={`block w-7 h-3.5 rounded-full relative transition-colors ${skill.enabled ? "bg-blue-600" : "bg-edge-strong"}`}>
            <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-gray-100 transition-all ${skill.enabled ? "left-[15px]" : "left-0.5"}`} />
          </span>
        </button>
        <button onClick={onDelete} disabled={busy} title="Delete"
          className="text-dim hover:text-red-400 text-xs leading-none opacity-0 group-hover:opacity-100 disabled:opacity-40">✕</button>
      </div>
    </div>
  );
}
