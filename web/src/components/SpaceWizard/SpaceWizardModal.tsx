import { useEffect, useMemo, useState, type CSSProperties, type TransitionEventHandler } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { EMPTY_SPACE_CONFIG, type InstalledItem, type InstallKind, type Space, type SpaceConfig, type SpacePreset, type Workspace } from "../../api/types";
import { useUi, spacesBarBottom, type SpaceWizardState, type WinRect } from "../../store/ui";
import { useDraggableWindow } from "../../hooks/useDraggableWindow";
import { ResizeHandles } from "../ResizeHandles";
import { PickerStep, type PickItem } from "./PickerStep";
import { InstallerStep } from "./InstallerStep";
import { BasicsStep, type Basics } from "./BasicsStep";
import { EnvStep } from "./EnvStep";
import { RulesStep } from "./RulesStep";
import { StartStep } from "./StartStep";

const RECT_KEY = "tr.spaceWizardRect";
const MIN_W = 560, MIN_H = 460;
const DURATION = 300;

function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(760, Math.round(vw * 0.62)), h = Math.min(640, Math.round(vh * 0.78));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}
function loadRect(): WinRect {
  try {
    const r = JSON.parse(localStorage.getItem(RECT_KEY) || "null") as Partial<WinRect> | null;
    if (r && typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.h === "number") {
      const vw = window.innerWidth, vh = window.innerHeight;
      const w = Math.max(MIN_W, Math.min(r.w, vw - 16)), h = Math.max(MIN_H, Math.min(r.h, vh - 16));
      return { w, h, x: Math.max(8, Math.min(vw - 80, r.x)), y: Math.max(8, Math.min(vh - 60, r.y)) };
    }
  } catch { /* ignore */ }
  return defaultRect();
}

type StepKey = "start" | "basics" | "skills" | "commands" | "mcp" | "env" | "rules";

/** The Space Creation Wizard — a floating, draggable window (grows from its opener, minimizes back)
 *  that walks the user through picking skills / commands / MCP servers / env / rules for a space.
 *  Store-driven (mounted in App from `spaceWizard`); `mode` "create" makes a new space, "edit"
 *  re-opens it pre-filled for an existing one. */
export function SpaceWizardModal({ state }: { state: SpaceWizardState }) {
  const qc = useQueryClient();
  const close = useUi((s) => s.closeSpaceWizard);
  const setActiveSpace = useUi((s) => s.setActiveSpace);

  const { data: catalog } = useQuery({ queryKey: ["space-catalog"], queryFn: api.spaceCatalog });
  const { data: presetData } = useQuery({ queryKey: ["space-presets"], queryFn: api.spacePresets.list });
  const presets = presetData?.presets ?? [];

  // Prefill from the cached spaces list in edit mode (the opener tile already rendered them, so the
  // cache is warm). Initialized once.
  const initial = useMemo(() => {
    let basics: Basics = { name: "", icon: null, color: null };
    let config: SpaceConfig = { ...EMPTY_SPACE_CONFIG };
    if (state.mode === "edit" && state.spaceId) {
      const cached = qc.getQueryData<{ spaces: Space[] }>(["spaces"]);
      const sp = cached?.spaces.find((s) => s.id === state.spaceId);
      if (sp) {
        basics = { name: sp.name, icon: sp.icon, color: sp.color };
        if (sp.config) config = { ...sp.config };
      }
    } else if (state.mode === "workspace" && state.workspaceId) {
      // Prefill from the workspace's OWN config (the cached list is warm — the room that opened this
      // already rendered it). Basics only carries the name here, for the title + submit gate.
      const cached = qc.getQueryData<{ workspaces: Workspace[] }>(["workspaces"]);
      const ws = cached?.workspaces.find((w) => w.id === state.workspaceId);
      if (ws) {
        basics = { name: ws.name, icon: null, color: ws.cardColor ?? ws.color };
        if (ws.config) config = { ...ws.config };
      }
    }
    return { basics, config };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [basics, setBasics] = useState<Basics>(initial.basics);
  const [config, setConfig] = useState<SpaceConfig>(initial.config);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // "applied to N workspaces — relaunch…"

  // Workspace mode only: what's ACTUALLY installed in this workspace folder right now (disk truth),
  // for the installer's "Installed" section. An install re-reads it so an item is only promoted once
  // the server confirms it landed on disk.
  const wsId = state.mode === "workspace" ? state.workspaceId ?? null : null;
  const installedQ = useQuery({ queryKey: ["ws-installed", wsId], queryFn: () => api.installed(wsId!), enabled: !!wsId });
  const installedSet = installedQ.data?.installed;
  const [installing, setInstalling] = useState<Set<string>>(() => new Set()); // keys `${kind}:${name}`
  const installedFor = (kind: InstallKind): InstalledItem[] =>
    kind === "skill" ? installedSet?.skills ?? [] : kind === "command" ? installedSet?.commands ?? [] : installedSet?.mcpServers ?? [];
  const doInstall = async (kind: InstallKind, name: string) => {
    if (!wsId) return;
    const key = `${kind}:${name}`;
    setInstalling((s) => new Set(s).add(key));
    setError(null);
    try {
      const { installed } = await api.installItem(wsId, { kind, name });
      qc.setQueryData(["ws-installed", wsId], { installed });
      const list = kind === "skill" ? installed.skills : kind === "command" ? installed.commands : installed.mcpServers;
      if (!list.some((i) => i.name === name)) setError(`Couldn't install "${name}" — its source wasn't found in your global Claude config.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "install failed");
    } finally {
      setInstalling((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const [seed] = useState(loadRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H);
  useEffect(() => {
    const t = window.setTimeout(() => { try { localStorage.setItem(RECT_KEY, JSON.stringify(rect)); } catch { /* */ } }, 300);
    return () => window.clearTimeout(t);
  }, [rect]);

  // Grow-from-opener / minimize-to-opener animation (same trick as NotesModal).
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { close(); return; } setExpanded(false); };
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) close();
  };

  // Steps: the preset/blank chooser shows only when creating AND presets exist; Basics (name/icon/
  // color) is skipped in workspace mode — the workspace already exists, we only edit its picks.
  const isWorkspace = state.mode === "workspace";
  const showStart = state.mode === "create" && presets.length > 0;
  const steps = useMemo<{ key: StepKey; title: string }[]>(() => ([
    ...(showStart ? [{ key: "start" as const, title: "Start" }] : []),
    ...(isWorkspace ? [] : [{ key: "basics" as const, title: "Basics" }]),
    { key: "skills", title: "Skills" },
    { key: "commands", title: "Commands" },
    { key: "mcp", title: "MCP servers" },
    // Env / secrets + Rules are space-wizard steps; the per-workspace manager is just skills/commands/MCP.
    ...(isWorkspace ? [] : [
      { key: "env" as const, title: "Env / secrets" },
      { key: "rules" as const, title: "Rules" },
    ]),
  ]), [showStart, isWorkspace]);
  const safeIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[safeIndex];
  const isLast = safeIndex === steps.length - 1;

  // Each pickable tab shows a live count — how many are installed in this workspace (workspace mode),
  // or how many are selected when building/editing a space. Env / Rules / Basics have no count.
  const tabCount = (key: StepKey): number | null => {
    if (key === "skills") return isWorkspace ? installedFor("skill").length : config.skills.length;
    if (key === "commands") return isWorkspace ? installedFor("command").length : config.commands.length;
    if (key === "mcp") return isWorkspace ? installedFor("mcp").length : config.mcpServers.length;
    return null;
  };

  const skillItems: PickItem[] = (catalog?.skills ?? []).map((s) => ({
    id: s.name, title: s.displayName, subtitle: s.displayName !== s.name ? s.name : null, description: s.description, category: s.category,
  }));
  const commandItems: PickItem[] = (catalog?.commands ?? []).map((c) => ({ id: c.name, title: c.name, description: c.description, category: c.category }));
  const mcpItems: PickItem[] = (catalog?.mcpServers ?? []).map((m) => ({ id: m.name, title: m.name, subtitle: m.transport, description: m.description, category: m.category }));

  const applyPreset = (p: SpacePreset) => {
    setConfig({ ...p.config, presetId: p.id });
    if (!basics.name) setBasics({ ...basics, icon: p.icon ?? basics.icon });
    setStepIndex(safeIndex + 1);
  };
  const deletePreset = async (id: string) => {
    try { await api.spacePresets.remove(id); qc.invalidateQueries({ queryKey: ["space-presets"] }); } catch { /* */ }
  };
  const saveAsPreset = async () => {
    const name = window.prompt("Save these selections as a preset named:", basics.name || "My preset");
    if (!name?.trim()) return;
    try {
      await api.spacePresets.create({ name: name.trim(), icon: basics.icon, config });
      qc.invalidateQueries({ queryKey: ["space-presets"] });
      setNotice(`Saved preset "${name.trim()}".`);
    } catch (e) { setError(e instanceof Error ? e.message : "could not save preset"); }
  };

  const submit = async () => {
    if (isWorkspace && state.workspaceId) {
      setBusy(true); setError(null);
      try {
        await api.updateWorkspace(state.workspaceId, { config });
        await api.seedWorkspace(state.workspaceId);
        qc.invalidateQueries({ queryKey: ["workspaces"] });
        setNotice("Applied to this workspace. Relaunch its terminals for the agent to pick up the changes.");
        setBusy(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "could not save");
        setBusy(false);
      }
      return;
    }
    if (!basics.name.trim()) { setError("Give the space a name."); return; }
    setBusy(true); setError(null);
    try {
      const payload = { name: basics.name.trim(), icon: basics.icon, color: basics.color, config };
      if (state.mode === "edit" && state.spaceId) {
        await api.updateSpace(state.spaceId, payload);
        const { results } = await api.seedSpace(state.spaceId);
        qc.invalidateQueries({ queryKey: ["spaces"] });
        qc.invalidateQueries({ queryKey: ["workspaces"] });
        const seeded = results.filter((r) => r.result).length;
        if (seeded > 0) {
          setNotice(`Applied to ${seeded} workspace${seeded > 1 ? "s" : ""}. Relaunch their terminals for the agent to pick up the changes.`);
          setBusy(false);
          return; // keep the window up so the notice is read; Done closes it
        }
      } else {
        const { space } = await api.createSpace(payload);
        qc.invalidateQueries({ queryKey: ["spaces"] });
        setActiveSpace(space.id);
      }
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
      setBusy(false);
    }
  };

  // Collapse target: shrink onto the opener rect (falls back to a centered shrink).
  const o = state.origin;
  const collapsed = o
    ? `translate(${o.x - rect.x}px, ${o.y - rect.y}px) scale(${o.w / rect.w}, ${o.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: o ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px,0px) scale(1,1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      {/* Title bar = drag handle */}
      <div onPointerDown={beginDrag}
        className="h-9 shrink-0 flex items-center justify-between px-4 border-b border-edge cursor-move select-none">
        <div className="font-semibold flex items-center gap-2">
          <span className={`codicon ${isWorkspace ? "codicon-tools" : "codicon-layers"} text-accent`} aria-hidden />
          {isWorkspace ? "Set up workspace" : state.mode === "edit" ? "Edit space config" : "New space"}
        </div>
        <button onClick={handleClose} title="Close" onPointerDown={(e) => e.stopPropagation()}
          className="px-3 h-6 inline-flex items-center bg-[#1c1c1c] rounded text-sm">Close</button>
      </div>

      {/* Step rail */}
      <div className="shrink-0 flex items-center gap-1 px-4 py-2 border-b border-edge overflow-x-auto">
        {steps.map((s, i) => {
          const count = tabCount(s.key);
          return (
            <button key={s.key} onClick={() => setStepIndex(i)}
              className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition
                ${i === safeIndex ? "bg-accent/15 text-accent" : i < safeIndex ? "text-bright hover:bg-[#1c1c1c]" : "text-dim hover:bg-[#1c1c1c]"}`}>
              {s.title}
              {count !== null && <span className="ml-1.5 text-[11px] tabular-nums opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Step body */}
      <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col">
        {step.key === "start" && (
          <StartStep presets={presets}
            onPickPreset={applyPreset}
            onBlank={() => { setConfig({ ...EMPTY_SPACE_CONFIG }); setStepIndex(safeIndex + 1); }}
            onDelete={deletePreset} />
        )}
        {step.key === "basics" && <BasicsStep basics={basics} onChange={setBasics} />}
        {step.key === "skills" && (isWorkspace ? (
          <InstallerStep kind="skill" catalog={skillItems} installed={installedFor("skill")} installing={installing}
            onInstall={(name) => doInstall("skill", name)} loading={installedQ.isLoading}
            searchPlaceholder="Search skills…"
            emptyHint="No skills found — none in ~/.claude/skills (global) or this workspace's .claude/skills. Add some, then reopen." />
        ) : (
          <PickerStep items={skillItems} selected={config.skills}
            onChange={(skills) => setConfig({ ...config, skills })}
            searchPlaceholder="Search your global skills"
            emptyHint="No global skills found in ~/.claude/skills. Install some in the Skills panel, then reopen this wizard." />
        ))}
        {step.key === "commands" && (isWorkspace ? (
          <InstallerStep kind="command" catalog={commandItems} installed={installedFor("command")} installing={installing}
            onInstall={(name) => doInstall("command", name)} loading={installedQ.isLoading}
            searchPlaceholder="Search commands…"
            emptyHint="No commands found — none in ~/.claude/commands (global) or this workspace's .claude/commands. Add some, then reopen." />
        ) : (
          <PickerStep items={commandItems} selected={config.commands}
            onChange={(commands) => setConfig({ ...config, commands })}
            searchPlaceholder="Search your global commands"
            emptyHint="No global slash commands found in ~/.claude/commands. Add some there, then reopen this wizard." />
        ))}
        {step.key === "mcp" && (isWorkspace ? (
          <InstallerStep kind="mcp" catalog={mcpItems} installed={installedFor("mcp")} installing={installing}
            onInstall={(name) => doInstall("mcp", name)} loading={installedQ.isLoading}
            searchPlaceholder="Search MCP servers…"
            emptyHint="No MCP servers found in your Claude config. Add some, then reopen — they'll show here as active." />
        ) : (
          <PickerStep items={mcpItems} selected={config.mcpServers}
            onChange={(mcpServers) => setConfig({ ...config, mcpServers })}
            searchPlaceholder="Search your global MCP servers"
            emptyHint="No global MCP servers found in ~/.claude.json. Configure some for Claude, then reopen this wizard." />
        ))}
        {step.key === "env" && <EnvStep env={config.env} onChange={(env) => setConfig({ ...config, env })} />}
        {step.key === "rules" && (
          <RulesStep claudeMd={config.claudeMd} seedTarget={config.seedTarget}
            onChange={(patch) => setConfig({ ...config, ...patch })} />
        )}
      </div>

      {/* Footer */}
      {(error || notice) && (
        <div className={`shrink-0 px-4 py-2 text-sm border-t ${error ? "border-red-500/40 text-red-400 bg-red-500/5" : "border-accent/30 text-accent bg-accent/5"}`}>
          {error ?? notice}
        </div>
      )}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t border-edge">
        <button onClick={saveAsPreset} disabled={busy}
          className="text-sm text-muted hover:text-bright disabled:opacity-40 flex items-center gap-1">
          <span className="codicon codicon-save" aria-hidden /> Save as preset
        </button>
        <div className="flex items-center gap-2">
          {safeIndex > 0 && (
            <button onClick={() => setStepIndex(safeIndex - 1)} disabled={busy}
              className="px-3 py-1.5 rounded text-sm bg-[#1c1c1c] hover:bg-white/10 disabled:opacity-40">Back</button>
          )}
          {notice && (state.mode === "edit" || isWorkspace) ? (
            <button onClick={handleClose} className="px-4 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500">Done</button>
          ) : isLast ? (
            <button onClick={submit} disabled={busy || !basics.name.trim()}
              className="px-4 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40">
              {busy ? "Saving…" : state.mode === "edit" || isWorkspace ? "Save & apply" : "Create space"}
            </button>
          ) : (
            <button onClick={() => setStepIndex(safeIndex + 1)}
              className="px-4 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500">Next</button>
          )}
        </div>
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
}
