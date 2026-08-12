import { useEffect, useMemo, useRef, useState } from "react";
import type { GuiAgent, GuiModel } from "../../api/guiTypes";
import { agentIconPath } from "../../lib/agents";
import { IS_MAC } from "../../lib/hotkey";
import { Pill, PillPopover, PopoverBody, PopoverRow } from "./ComposerPopover";
import { findModel } from "./composerOptions";

const MENU_W = 340;
const CHORDS = 9; // ⌘1…⌘9 — one per digit, so only the first nine visible rows carry one

/**
 * Which model the turn runs on. Every row comes from the server's catalog (read off the installed
 * CLI), so this component has no idea what models exist and never needs updating when new ones ship.
 */
export function ModelPill({ agent, models, model, onPick }: {
  /** Whose catalog this is — the pill wears that CLI's mark so a Codex chat never looks like a
   *  Claude one. null only while the socket is still saying. */
  agent: GuiAgent | null;
  models: GuiModel[];
  model: string | null;
  onPick: (value: string) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = findModel(models, model);
  // No catalog row matched: show the id the server actually holds rather than a guess at its name.
  const label = selected ? selected.displayName : model ?? "Default";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => `${m.displayName} ${m.description}`.toLowerCase().includes(q));
  }, [models, query]);

  const close = () => { setOpen(false); setQuery(""); };
  const pick = (value: string) => { close(); onPick(value); };

  // Chords are POSITIONAL — ⌘1 is always "the first row I can see" — so they keep meaning the same
  // thing as the filter narrows the list instead of pointing at a model that scrolled out of view.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const row = visible[Number(e.key) - 1];
      if (!row) return;
      e.preventDefault();
      pick(row.value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, visible, onPick]);

  return (
    <>
      <Pill
        ref={btnRef}
        label={label}
        title={selected?.description || "Model"}
        open={open}
        icon={agent ? <img src={agentIconPath(agent)} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" /> : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <PillPopover anchor={btnRef} width={MENU_W} onClose={close}>
          <div className="shrink-0 border-b border-edge p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="w-full rounded-md border border-edge bg-surface px-2 py-1 text-[13px] text-fg outline-none transition-colors placeholder:text-dim focus:border-accent/60"
            />
          </div>
          <PopoverBody>
            {visible.length === 0 && <div className="px-3 py-4 text-center text-xs text-dim">No matching model.</div>}
            {visible.map((m, i) => (
              <PopoverRow
                key={m.value}
                title={m.displayName}
                description={m.description}
                badge={i < CHORDS ? `${IS_MAC ? "⌘" : "Ctrl+"}${i + 1}` : undefined}
                selected={selected?.value === m.value}
                onClick={() => pick(m.value)}
              />
            ))}
          </PopoverBody>
        </PillPopover>
      )}
    </>
  );
}
