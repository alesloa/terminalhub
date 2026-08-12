import { useEffect, useState, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { HeadroomStatus } from "../api/types";
import type { GuiAgent } from "../api/guiTypes";
import { agentIconPath } from "../lib/agents";
import { useRoom } from "../store/room";
import { useUi } from "../store/ui";
import { ClaudeLoopWizard } from "./ClaudeLoopWizard";

const FALLBACK_ICON = "/agents/terminal.svg";
const MAX_ICON_BYTES = 256 * 1024; // matches the server cap

/** Centered "new terminal" modal: pick a detected agent CLI, a plain shell, or a custom one. */
export function AgentPicker({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const close = useRoom(s => s.closeAgentPicker);
  const requestTerminalFocus = useUi(s => s.requestTerminalFocus);
  // Scoped to this workspace: its own saved commands plus the shared ones. Keyed by workspace so
  // opening the picker in another room doesn't reuse this room's list from cache.
  const { data } = useQuery({ queryKey: ["agents", workspaceId], queryFn: () => api.listAgents(workspaceId) });
  // The special "Claude (Headroom)" launcher: separate endpoint so its network probe never delays the
  // main list. Polled while the picker is open so the running dot stays fresh.
  const { data: hr } = useQuery({ queryKey: ["agents", "headroom"], queryFn: api.headroomStatus, refetchInterval: 15_000 });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const headroomHidden = settings?.headroomLauncherHidden ?? false;
  const setHeadroomHidden = useMutation({
    mutationFn: (hidden: boolean) => api.updateSettings({ headroomLauncherHidden: hidden }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const [hrInstall, setHrInstall] = useState(false); // show install steps when the CLI is missing

  // Built-in agent cards the user removed from the picker (persisted server-side). Plain terminal is
  // never removable; customs delete outright; Headroom uses its own headroomLauncherHidden flag above.
  // Removed agents are re-addable from the "+ Add a CLI" panel's detected list.
  const removedAgents = settings?.removedAgents ?? [];
  const setRemovedAgents = useMutation({
    mutationFn: (ids: string[]) => api.updateSettings({ removedAgents: ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const removeAgent = (id: string) => { if (!removedAgents.includes(id)) setRemovedAgents.mutate([...removedAgents, id]); };
  const readdAgent = (id: string) => setRemovedAgents.mutate(removedAgents.filter(x => x !== id));

  // Per-terminal system-prompt layer set in this picker; applied to the next launch. `includeParent`
  // false = ignore the workspace + global prompt and use only this text. Only built-in agents (which
  // carry an agentId) are injected — see the server's applySystemPrompt.
  const [sysText, setSysText] = useState("");
  const [sysIncludeParent, setSysIncludeParent] = useState(true);
  const [sysOpen, setSysOpen] = useState(false);
  const termPrompt = () => sysText.trim() ? { text: sysText.trim(), includeParent: sysIncludeParent } : null;

  const launch = useMutation({
    mutationFn: ({ command, title, agentId }: { command: string; title: string; agentId: string | null }) =>
      api.createTerminal(workspaceId, { launchCommandOverride: command, title, agentId, systemPrompt: termPrompt() }),
    // Focus the new terminal via the room's pending-focus channel, not setActive directly: the
    // workspaces query hasn't refetched yet, so the new id isn't in the list and Room's
    // "keep-active-valid" effect would snap focus back to the first terminal. The pending request
    // is honored once the terminal actually appears.
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["workspaces"] }); requestTerminalFocus(workspaceId, r.terminal.id); close(); },
  });
  const pick = (command: string, title: string, agentId: string | null = null) => { if (!launch.isPending) launch.mutate({ command, title, agentId }); };

  // GUI mode: nothing runs in the pane — the agent runs as a child of the hub and the terminal opens
  // straight into the in-app chat. The launch command is still recorded, because it is what decides
  // WHICH agent the chat drives (server/src/gui/agent.ts) and what gets typed back into the pane on a
  // switch to tmux. Focus + close behave like a normal pick.
  const launchGui = useMutation({
    mutationFn: (agent: { id: GuiAgent; label: string; command: string }) =>
      api.createTerminal(workspaceId, {
        title: `${agent.label} (GUI)`, agentId: agent.id, launchCommandOverride: agent.command,
        mode: "gui", systemPrompt: termPrompt(),
      }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["workspaces"] }); requestTerminalFocus(workspaceId, r.terminal.id); close(); },
  });

  // Which bottom panel is expanded: the add-a-CLI form, the Claude-loop wizard, or neither.
  const [panel, setPanel] = useState<"none" | "cli" | "loop">("none");
  // The detected Claude CLI command, used to launch the loop session (falls back to plain `claude`).
  const claudeBuiltin = (data?.builtin ?? []).find(a => a.id === "claude");
  const claudeCommand = claudeBuiltin?.command ?? "claude";

  // A Claude loop opens a fresh `claude` session; `kickoff` is the /loop or /goal line the server
  // types in once the agent is up (see runKickoff). Focus + close behave like a normal pick.
  const launchLoop = useMutation({
    mutationFn: (kickoff: string) =>
      api.createTerminal(workspaceId, { launchCommandOverride: claudeCommand, title: "Claude Task", kickoff, agentId: "claude", systemPrompt: termPrompt() }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["workspaces"] }); requestTerminalFocus(workspaceId, r.terminal.id); close(); },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const installedBuiltins = (data?.builtin ?? []).filter(a => a.installed); // only installed; missing ones are hidden
  const shownBuiltins = installedBuiltins.filter(a => !removedAgents.includes(a.id)); // minus user-removed
  const customs = data?.custom ?? [];

  // The agents the in-app chat can drive. Claude's card always shows (GUI mode has always been the
  // fallback for a machine with no CLI detected at all); Codex's needs its binary, since the chat
  // drives the real `codex app-server`.
  const guiAgents = ([
    { id: "claude", label: "Claude" },
    { id: "codex", label: "Codex" },
  ] as const).flatMap(({ id, label }) => {
    const builtin = installedBuiltins.find(a => a.id === id);
    if (id === "codex" && !builtin) return [];
    return [{ id, label, command: builtin?.command ?? id }];
  });

  // Installed agents the user can re-add from the Add panel: detected built-ins + Headroom (if its CLI
  // is present). `removed` reflects current visibility; `toggle` flips it.
  const detected = [
    ...installedBuiltins.map(a => ({
      id: a.id, name: a.name, icon: `/agents/${a.id}.svg`,
      removed: removedAgents.includes(a.id),
      toggle: () => (removedAgents.includes(a.id) ? readdAgent(a.id) : removeAgent(a.id)),
    })),
    ...(hr?.installed ? [{
      id: "headroom", name: "Claude (Headroom)", icon: "/agents/claude-headroom.svg",
      removed: headroomHidden, toggle: () => setHeadroomHidden.mutate(!headroomHidden),
    }] : []),
  ];

  // Group custom CLIs by their chosen category. "Detected agents" is reserved for $PATH-detected
  // built-ins; user CLIs live under "Other" (the default) or any category they name. Each non-"Other"
  // category renders as its own section between Detected and Other; "Other"-tagged CLIs share the
  // "Other" section with the Plain terminal.
  const byCat = new Map<string, typeof customs>();
  for (const a of customs) {
    const cat = a.category?.trim() || "Other";
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(a);
  }
  const otherCustoms = byCat.get("Other") ?? [];
  const customCats = [...byCat.keys()].filter(c => c !== "Other").sort((a, b) => a.localeCompare(b));
  // Existing category names, surfaced in the add-form autocomplete so the user can reuse one.
  const knownCats = [...new Set(["Other", ...customs.map(a => a.category?.trim() || "Other")])];

  const customCard = (a: (typeof customs)[number]) => (
    <AgentCard key={a.id} icon={a.icon ?? FALLBACK_ICON} name={a.name} blurb={a.command}
      // Only this workspace's own commands are marked — the shared ones are the norm, so a badge on
      // those would just be noise on every card.
      tag={a.workspaceId ? "THIS FOLDER" : undefined}
      onClick={() => pick(a.command, a.name)}
      onDelete={async () => { await api.deleteAgent(a.id); qc.invalidateQueries({ queryKey: ["agents"] }); }} />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={close}>
      <div className="w-[min(680px,92vw)] max-h-[86vh] overflow-auto rounded-xl border border-edge bg-canvas shadow-2xl"
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div className="font-semibold">New terminal</div>
          <button onClick={close} className="text-dim hover:text-fg text-lg leading-none">✕</button>
        </div>

        <div className="p-5">
          <div className="text-xs uppercase tracking-wide text-dim mb-2">Detected agents</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {shownBuiltins.map(a => (
              <AgentCard key={a.id} icon={`/agents/${a.id}.svg`} name={a.name} blurb={a.blurb}
                onClick={() => pick(a.command, a.name, a.id)}
                onDelete={() => removeAgent(a.id)} />
            ))}
            {guiAgents.map(agent => (
              <GuiCard key={agent.id} agentId={agent.id} label={agent.label} pending={launchGui.isPending}
                onLaunch={() => { if (!launchGui.isPending) launchGui.mutate(agent); }} />
            ))}
            {!headroomHidden && (
              <HeadroomCard status={hr} pending={launch.isPending || setHeadroomHidden.isPending}
                onLaunch={() => { if (hr) pick(hr.command, "Claude (Headroom)", "claude"); }}
                onInstall={() => setHrInstall(v => !v)}
                onHide={() => setHeadroomHidden.mutate(true)} />
            )}
            {shownBuiltins.length === 0 && headroomHidden && (
              <div className="col-span-full text-sm text-dim">
                No agent CLIs detected — use Claude (GUI) above, open a plain terminal, or add one from “+ Add a CLI” below.
              </div>
            )}
          </div>
          {!headroomHidden && hrInstall && hr && !hr.installed && (
            <HeadroomInstall status={hr} onClose={() => setHrInstall(false)} />
          )}

          {customCats.map(cat => (
            <div key={cat}>
              <div className="text-xs uppercase tracking-wide text-dim mt-5 mb-2">{cat}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {byCat.get(cat)!.map(customCard)}
              </div>
            </div>
          ))}

          <div className="text-xs uppercase tracking-wide text-dim mt-5 mb-2">Other</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <AgentCard icon={FALLBACK_ICON} name="Plain terminal" blurb="Just a shell"
              onClick={() => pick("", "Terminal", null)} />
            {otherCustoms.map(customCard)}
          </div>

          <div className="mt-5 border-t border-edge pt-4">
            <button onClick={() => setSysOpen(v => !v)} className="text-sm text-dim hover:text-fg flex items-center gap-1.5">
              <span className="text-xs">{sysOpen ? "▾" : "▸"}</span>
              System message for this terminal
              {sysText.trim() && <span className="w-1.5 h-1.5 rounded-full bg-accent" title="set" />}
            </button>
            {sysOpen && (
              <div className="mt-2 flex flex-col gap-2">
                <textarea value={sysText} onChange={e => setSysText(e.target.value)} rows={4}
                  placeholder="Extra instructions, persona, or context for the agent you launch next…"
                  className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60 resize-y" />
                <label className="flex items-center gap-2 text-xs text-dim">
                  <input type="checkbox" checked={sysIncludeParent} onChange={e => setSysIncludeParent(e.target.checked)} />
                  Build on the workspace + global prompt (uncheck to use only this text)
                </label>
                <div className="text-xs text-dim">
                  Applies to built-in agents (Claude, Codex, Cursor, Gemini, opencode). Set it, then pick an agent above.
                </div>
              </div>
            )}
          </div>

          {panel === "none" && (
            <div className="mt-5 flex items-center gap-4">
              <button onClick={() => setPanel("cli")} className="text-sm text-blue-400 hover:text-blue-300">+ Add a CLI</button>
              <button onClick={() => setPanel("loop")} className="text-sm text-blue-400 hover:text-blue-300">+ Add Claude Task</button>
            </div>
          )}
          {panel === "cli" && (
            <AddAgentForm knownCats={knownCats} detected={detected} workspaceId={workspaceId}
              onClose={() => setPanel("none")}
              onAdded={() => qc.invalidateQueries({ queryKey: ["agents"] })} />
          )}
          {panel === "loop" && (
            <ClaudeLoopWizard claudeInstalled={!!claudeBuiltin?.installed} starting={launchLoop.isPending}
              onStart={(cmd) => { if (!launchLoop.isPending) launchLoop.mutate(cmd); }}
              onClose={() => setPanel("none")} />
          )}
        </div>
      </div>
    </div>
  );
}

function AgentCard({ icon, name, blurb, tag, onClick, onDelete }: {
  icon: string; name: string; blurb?: string; tag?: string; onClick: () => void; onDelete?: () => void;
}) {
  return (
    <div className="group relative">
      <button onClick={onClick}
        className="w-full flex items-center gap-3 p-3 rounded-lg border border-edge bg-panel text-left
          hover:border-accent/60 hover:bg-surface">
        <img src={icon} alt="" className="w-7 h-7 shrink-0 object-contain" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-sm text-bright">{name}</span>
            {tag && <span className="shrink-0 rounded bg-elevated px-1 py-px text-[9px] tracking-wide text-dim">{tag}</span>}
          </span>
          {blurb && <span className="block truncate text-xs text-dim">{blurb}</span>}
        </span>
      </button>
      {onDelete && (
        <button onClick={onDelete} title="Remove"
          className="absolute top-1 right-1 hidden group-hover:block text-dim hover:text-red-400 text-xs leading-none">✕</button>
      )}
    </div>
  );
}

/** The "Claude (Headroom)" launcher card. Unlike the detected built-ins, it shows even when the CLI
 *  is missing — grayed out, with a click that opens install steps. A green/amber dot reflects whether
 *  the compression proxy is live (it auto-starts on launch either way). Hover ✕ hides it. */
function HeadroomCard({ status, pending, onLaunch, onInstall, onHide }: {
  status?: HeadroomStatus; pending: boolean;
  onLaunch: () => void; onInstall: () => void; onHide: () => void;
}) {
  const installed = status?.installed ?? false;
  const running = status?.running ?? false;
  return (
    <div className="group relative">
      <button disabled={pending} onClick={() => (installed ? onLaunch() : onInstall())}
        title={installed
          ? (running ? "Headroom proxy running" : "Headroom installed — the proxy starts automatically on launch")
          : "Headroom not installed — click for install steps"}
        className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors disabled:opacity-50
          ${installed
            ? "border-edge bg-panel hover:border-accent/60 hover:bg-surface"
            : "border-edge/60 bg-panel/40 opacity-60 hover:opacity-90"}`}>
        <img src="/agents/claude-headroom.svg" alt="" className="w-7 h-7 shrink-0 object-contain" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm text-bright">
            <span className="truncate">Claude (Headroom)</span>
            {installed && (
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${running ? "bg-accent" : "bg-amber-400"}`}
                title={running ? "proxy running" : "proxy stopped — starts on launch"} />
            )}
          </span>
          <span className="block truncate text-xs text-dim">
            {installed ? "Claude through Headroom compression" : "Not installed — click to install"}
          </span>
        </span>
      </button>
      <button onClick={onHide} title="Hide this launcher"
        className="absolute top-1 right-1 hidden group-hover:block text-dim hover:text-red-400 text-xs leading-none">✕</button>
    </div>
  );
}

/** A "<agent> (GUI)" launcher card. Same agent, different surface: no CLI in the pane — the terminal
 *  opens straight into the in-app chat. Carries the accent border + a GUI chip so it can't be
 *  mistaken for the plain card of the same agent sitting next to it. */
function GuiCard({ agentId, label, pending, onLaunch }: {
  agentId: GuiAgent; label: string; pending: boolean; onLaunch: () => void;
}) {
  return (
    <div className="group relative">
      <button disabled={pending} onClick={onLaunch}
        title={`Chat with ${label} inside Terminalhub — no terminal pane`}
        className="w-full flex items-center gap-3 p-3 rounded-lg border border-accent/40 bg-accent/5 text-left
          transition-colors hover:border-accent/70 hover:bg-accent/10 disabled:opacity-50">
        <img src={agentIconPath(agentId)} alt="" className="w-7 h-7 shrink-0 object-contain" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm text-bright">
            <span className="truncate">{label} (GUI)</span>
            <span className="shrink-0 px-1 rounded border border-accent/50 text-[9px] leading-[13px] tracking-wide text-accent">GUI</span>
          </span>
          <span className="block truncate text-xs text-dim">In-app chat, no terminal</span>
        </span>
      </button>
    </div>
  );
}

/** Inline install steps shown when the Headroom CLI is missing and the user clicks the grayed card. */
function HeadroomInstall({ status, onClose }: { status: HeadroomStatus; onClose: () => void }) {
  return (
    <div className="mt-3 p-4 rounded-lg border border-edge bg-panel">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium">Install Headroom</div>
        <button onClick={onClose} className="text-dim hover:text-fg text-sm leading-none">✕</button>
      </div>
      <div className="text-xs text-dim mb-2">
        Local context-compression proxy for Claude — trims tokens before they reach Anthropic. Runs on your machine.
      </div>
      <code className="block px-2 py-1.5 rounded bg-canvas border border-edge font-mono text-[11px] text-bright select-all break-all">
        {status.installHint}
      </code>
      <div className="text-xs text-dim mt-2">
        After installing, reopen this menu (restart the server if it still shows as missing).{" "}
        <a href={status.repoUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300">Docs ↗</a>
      </div>
    </div>
  );
}

type DetectedAgent = { id: string; name: string; icon: string; removed: boolean; toggle: () => void };

function AddAgentForm({ knownCats, detected, workspaceId, onAdded, onClose }: {
  knownCats: string[]; detected: DetectedAgent[]; workspaceId: string; onAdded: () => void; onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [category, setCategory] = useState("Other");
  const [icon, setIcon] = useState<string | null>(null);
  const [err, setErr] = useState("");
  // Default to this workspace: `npm run dev` means a different thing in every folder, so a saved
  // command belongs to its project unless the user says otherwise.
  const [shared, setShared] = useState(false);

  // What this folder can actually run — its package.json scripts, through the package manager its
  // lockfile names — plus the usual suspects it doesn't define.
  const { data: presetData } = useQuery({
    queryKey: ["agents", "presets", workspaceId],
    queryFn: () => api.commandPresets(workspaceId),
    staleTime: 60_000,
  });
  const presets = presetData?.presets ?? [];
  const scripts = presets.filter(p => p.source === "script");
  const common = presets.filter(p => p.source === "common");

  /** Picking a preset fills the command, and the name too unless one has been typed. */
  const usePreset = (value: string) => {
    if (!value) return;
    setCommand(value);
    setName(n => (n.trim() ? n : value));
  };

  const save = useMutation({
    mutationFn: () => api.createAgent({
      name: name.trim(), command: command.trim(), icon, category: category.trim() || "Other",
      workspaceId: shared ? null : workspaceId,
    }),
    onSuccess: () => { onAdded(); onClose(); },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "failed"),
  });

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > MAX_ICON_BYTES) { setErr("Icon too big (max 256 KB)"); return; }
    setErr("");
    const r = new FileReader();
    r.onload = () => setIcon(typeof r.result === "string" ? r.result : null);
    r.readAsDataURL(f);
  };

  const canSave = !!name.trim() && !!command.trim() && !save.isPending;
  return (
    <div className="mt-5 p-4 rounded-lg border border-edge bg-panel">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Add a CLI</div>
        <button onClick={onClose} className="text-dim hover:text-fg text-sm leading-none">✕</button>
      </div>
      {/* Agents detected on this machine — re-add any you removed from the picker. */}
      {detected.length > 0 && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-dim mb-2">Detected on your computer</div>
          <div className="flex flex-col gap-1.5">
            {detected.map(d => (
              <div key={d.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded border border-edge bg-canvas">
                <img src={d.icon} alt="" className="w-5 h-5 shrink-0 object-contain" />
                <span className="flex-1 min-w-0 truncate text-sm text-bright">{d.name}</span>
                {d.removed
                  ? <button onClick={d.toggle} className="shrink-0 text-xs text-blue-400 hover:text-blue-300">Add</button>
                  : <span className="shrink-0 text-xs text-dim">Added</span>}
              </div>
            ))}
          </div>
          <div className="text-xs uppercase tracking-wide text-dim mt-4 mb-2">Or add a custom CLI</div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {/* Start from something this folder can already run, instead of typing it out. Resets to the
            placeholder after each pick so the same preset can be chosen twice. */}
        {presets.length > 0 && (
          <select value="" onChange={e => usePreset(e.target.value)}
            className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60">
            <option value="">Start from a command…</option>
            {scripts.length > 0 && (
              <optgroup label="Scripts in this folder">
                {scripts.map(p => (
                  <option key={p.command} value={p.command}>{p.label}{p.detail ? ` — ${p.detail}` : ""}</option>
                ))}
              </optgroup>
            )}
            {common.length > 0 && (
              <optgroup label="Common">
                {common.map(p => <option key={p.command} value={p.command}>{p.label}</option>)}
              </optgroup>
            )}
          </select>
        )}
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. Aider)"
          className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60" />
        <input value={command} onChange={e => setCommand(e.target.value)} placeholder="Launch command (e.g. aider)"
          className="px-3 py-2 rounded bg-canvas border border-edge text-sm font-mono outline-none focus:border-accent/60" />
        {/* Where it shows up. This workspace by default — see the state above. */}
        <select value={shared ? "shared" : "workspace"} onChange={e => setShared(e.target.value === "shared")}
          className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60">
          <option value="workspace">Only this workspace</option>
          <option value="shared">Every workspace</option>
        </select>
        {/* Category: type a new one or pick an existing (datalist). "Detected agents" is reserved for
            $PATH-detected built-ins; the server coerces it to "Other". Blank → "Other". */}
        <input value={category} onChange={e => setCategory(e.target.value)} list="agent-cats" placeholder="Category (e.g. Other)"
          className="px-3 py-2 rounded bg-canvas border border-edge text-sm outline-none focus:border-accent/60" />
        <datalist id="agent-cats">
          {knownCats.map(c => <option key={c} value={c} />)}
        </datalist>
        <div className="flex items-center gap-3">
          {icon
            ? <img src={icon} alt="" className="w-8 h-8 object-contain rounded" />
            : <div className="w-8 h-8 rounded bg-canvas border border-edge" />}
          <label className="text-sm text-blue-400 hover:text-blue-300 cursor-pointer">
            Upload icon
            <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onFile} className="hidden" />
          </label>
          {icon && <button onClick={() => setIcon(null)} className="text-xs text-dim hover:text-fg">clear</button>}
        </div>
        {err && <div className="text-xs text-red-400">{err}</div>}
        <div className="flex gap-2">
          <button disabled={!canSave} onClick={() => save.mutate()}
            className="px-3 py-1.5 rounded bg-blue-600 text-sm disabled:opacity-40">Save</button>
          <button onClick={onClose} className="px-3 py-1.5 rounded bg-elevated text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}
