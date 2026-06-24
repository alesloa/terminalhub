import { useState } from "react";
import type { LeftTab } from "../../store/ui";
import { useRoom } from "../../store/room";
import { FileTree } from "./FileTree";

const TABS: { id: LeftTab; label: string }[] = [
  { id: "explorer", label: "Explorer" },
  { id: "filter", label: "Filter Files" },
  { id: "search", label: "Search" },
];

export function LeftPanel({ rootPath }: { rootPath: string }) {
  const leftTab = useRoom(s => s.leftTab);
  const setLeftTab = useRoom(s => s.setLeftTab);
  const [filter, setFilter] = useState("");

  return (
    <div className="w-60 shrink-0 border-r border-edge flex flex-col bg-canvas">
      <div className="flex text-xs">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setLeftTab(t.id)}
            className={`px-3 py-2 ${leftTab === t.id ? "text-fg border-b-2 border-blue-500" : "text-dim hover:text-fg"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {leftTab === "filter" && (
        <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter by filename…"
          className="mx-2 my-2 px-2 py-1 text-sm bg-panel border border-edge rounded outline-none focus:border-blue-500" />
      )}

      <div className="flex-1 overflow-auto py-1">
        {leftTab === "search" ? (
          <div className="px-3 py-2 text-xs text-dim">Content search lands next.</div>
        ) : (
          <FileTree rootPath={rootPath} filter={leftTab === "filter" ? filter : ""} />
        )}
      </div>
    </div>
  );
}
