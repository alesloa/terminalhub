import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useEscape } from "../../hooks/useEscape";
import type { InstalledSkill } from "../../api/types";

/** Read-only viewer for a skill's SKILL.md (raw markdown source). */
export function SkillViewerModal({ skill, workspace, onClose }: {
  skill: InstalledSkill;
  workspace: string;
  onClose: () => void;
}) {
  useEscape(onClose);
  const q = useQuery({
    queryKey: ["skills", "content", skill.installPath],
    queryFn: () => api.skills.content(skill.installPath, workspace),
  });

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80]" onMouseDown={onClose}>
      <div className="bg-panel w-[640px] max-w-[92vw] max-h-[82vh] rounded-lg border border-edge flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm text-bright truncate">{skill.displayName}</div>
            <div className="text-[11px] text-dim truncate">{skill.installPath}</div>
          </div>
          <button onClick={onClose} className="text-dim hover:text-fg text-sm">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {q.isLoading && <div className="text-xs text-dim">loading…</div>}
          {q.isError && <div className="text-xs text-red-400">{(q.error as Error).message}</div>}
          {q.data && <pre className="text-[12px] text-fg whitespace-pre-wrap font-mono leading-relaxed">{q.data.content}</pre>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
