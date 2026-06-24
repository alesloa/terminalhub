import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, Position, useReactFlow, useUpdateNodeInternals, MarkerType, type NodeProps } from "@xyflow/react";
import type { BlueprintNode, BlueprintNodeKind } from "../../../api/types";

// Custom React Flow nodes. Double-click a node to edit its label + description inline; the text is
// stored in the node's data (React Flow's `updateNodeData`), so the canvas state stays the single
// source of truth that gets serialized and saved. Inputs carry the `nodrag` class so typing/select
// doesn't drag the node, and stopPropagation on double-click keeps React Flow from zooming.
//
// Every kind shows a plain-English name big and its technical term small + faded underneath, so a
// non-programmer reads "Repeat" while a programmer also sees "loop". Wiring is pure drag: drag a
// handle dot onto another box's dot to connect, or drop on empty canvas to spawn the next box
// (handled in BlueprintCanvas). No add-buttons.

type NodeData = { label: string; description?: string; cases?: string[] };

// Per-kind metadata: friendly name, technical term, and colors. One source of truth for the nodes,
// the toolbar "Add" menu, the right-click "Change type" menu, and the minimap colors.
export type KindMeta = { name: string; tech: string; accent: string; border: string; bg: string; dot: string; mini: string };
export const KIND_META: Record<BlueprintNodeKind, KindMeta> = {
  start:     { name: "Start",        tech: "start",         accent: "text-emerald-400", border: "border-emerald-600/50", bg: "bg-[#0e1a14]", dot: "!bg-emerald-500",  mini: "#10b981" },
  action:    { name: "Do a step",    tech: "action",        accent: "text-blue-400",    border: "border-blue-600/50",    bg: "bg-canvas", dot: "!bg-blue-500",     mini: "rgb(var(--tr-accent))" },
  condition: { name: "Yes / no",     tech: "if · condition", accent: "text-amber-400",  border: "border-amber-600/50",   bg: "bg-[#1a160d]", dot: "!bg-amber-500",    mini: "#f59e0b" },
  loop:      { name: "Repeat",       tech: "loop",          accent: "text-violet-400",  border: "border-violet-600/50",  bg: "bg-[#150d1a]", dot: "!bg-violet-500",   mini: "#8b5cf6" },
  switch:    { name: "Pick a path",  tech: "switch",        accent: "text-fuchsia-400", border: "border-fuchsia-600/50", bg: "bg-[#1a0d18]", dot: "!bg-fuchsia-500",  mini: "#d946ef" },
  parallel:  { name: "All at once",  tech: "parallel",      accent: "text-cyan-400",    border: "border-cyan-600/50",    bg: "bg-[#0b1a1c]", dot: "!bg-cyan-500",     mini: "#06b6d4" },
  try:       { name: "Try it",       tech: "try / catch",   accent: "text-orange-400",  border: "border-orange-600/50",  bg: "bg-[#1a120b]", dot: "!bg-orange-500",   mini: "#f97316" },
  param:     { name: "Info to give", tech: "input",         accent: "text-slate-300",   border: "border-slate-500/50",   bg: "bg-panel", dot: "!bg-slate-400",    mini: "rgb(var(--tr-text-muted))" },
  group:     { name: "Section",      tech: "phase · group", accent: "text-zinc-300",    border: "border-zinc-500/50",    bg: "bg-canvas", dot: "!bg-zinc-400",     mini: "rgb(var(--tr-text-muted))" },
  end:       { name: "Finish",       tech: "end · result",  accent: "text-rose-400",    border: "border-rose-600/50",    bg: "bg-[#1a0d12]", dot: "!bg-rose-500",     mini: "rgb(var(--tr-error))" },
};
// Everything you can add or convert to (Start is unique — exactly one, never created/converted).
export const ADDABLE_KINDS: BlueprintNodeKind[] = ["action", "condition", "loop", "switch", "parallel", "try", "param", "group", "end"];
// The default source handle a converted node's outgoing edges snap to (branching kinds only).
export const DEFAULT_HANDLE: Partial<Record<BlueprintNodeKind, string>> = { condition: "yes", loop: "body", try: "ok", switch: "c0" };

/** The kind's friendly name + faded technical term, shown atop every node and in both menus. */
function KindTag({ kind, accent }: { kind: BlueprintNodeKind; accent: string }) {
  const m = KIND_META[kind];
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`text-[10px] font-semibold ${accent}`}>{m.name}</span>
      <span className="text-[8px] text-dim lowercase tracking-wide">{m.tech}</span>
    </span>
  );
}

function Editable({ id, data, kind }: { id: string; data: NodeData; kind: BlueprintNodeKind }) {
  const rf = useReactFlow();
  const [editing, setEditing] = useState(false);
  const accent = KIND_META[kind].accent;

  if (editing) {
    return (
      <div className="space-y-1"
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false); }}>
        <KindTag kind={kind} accent={accent} />
        <input autoFocus value={data.label} placeholder="name this step"
          onChange={e => rf.updateNodeData(id, { label: e.target.value })}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); else if (e.key === "Escape") setEditing(false); }}
          className="nodrag w-full px-1.5 py-1 text-xs bg-canvas border border-edge-strong rounded outline-none focus:border-blue-500 text-bright" />
        <textarea value={data.description ?? ""} placeholder="what it does (optional)" rows={2}
          onChange={e => rf.updateNodeData(id, { description: e.target.value })}
          onKeyDown={e => { if (e.key === "Escape") setEditing(false); }}
          className="nodrag w-full px-1.5 py-1 text-[11px] bg-canvas border border-edge-strong rounded outline-none focus:border-blue-500 text-fg resize-none" />
      </div>
    );
  }
  return (
    <div onDoubleClick={e => { e.stopPropagation(); setEditing(true); }}>
      <div className="mb-1"><KindTag kind={kind} accent={accent} /></div>
      <div className="text-bright font-medium break-words text-xs leading-snug line-clamp-2">
        {data.label?.trim() || <span className="text-dim font-normal">double-click to name</span>}
      </div>
      {data.description?.trim() && <div className="text-muted mt-0.5 break-words text-[11px] leading-snug line-clamp-3">{data.description}</div>}
    </div>
  );
}

const BASE = "rounded-md border px-3 py-2 shadow-md w-[200px]";
// Bigger handle dots: dragging a dot is the only way to wire steps, so make the grab target obvious
// and easy to hit. Crosshair cursor + a brightness lift on hover signal "drag me to connect" — note
// the hover cue must be a `filter` (not a transform/scale), since React Flow uses the dot's
// `transform` to center it; a Tailwind scale utility would clobber that and make the dot jump.
const dot = "!w-3.5 !h-3.5 !border-2 !border-canvas cursor-crosshair transition-[filter] hover:!brightness-150";

// Shared edge style so every edge — drawn by hand or dropped on a node — looks the same: a
// right-angle (smoothstep) connector with an arrowhead, the flowchart standard.
export const EDGE_DEFAULTS = {
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "rgb(var(--tr-text-dim))" },
  style: { stroke: "rgb(var(--tr-text-dim))", strokeWidth: 1.5 },
};
export const mkEdge = (source: string, target: string, sourceHandle: string | null = null) => ({
  id: `e_${source}_${target}_${sourceHandle ?? "d"}`, source, target, sourceHandle, ...EDGE_DEFAULTS,
});

/** Outer node frame: selection ring + a delete ✕ that appears on hover/selection (not on Start). */
function NodeBox({ kind, id, selected, children }:
  { kind: BlueprintNodeKind; id: string; selected?: boolean; children: ReactNode }) {
  const { deleteElements } = useReactFlow();
  const m = KIND_META[kind];
  const reveal = selected ? "opacity-100" : "opacity-0 group-hover:opacity-100";
  return (
    <div className={`group ${BASE} ${m.bg} ${m.border} relative transition-shadow ${selected ? "ring-2 ring-blue-400/80 ring-offset-1 ring-offset-canvas" : ""}`}>
      {kind !== "start" && (
        <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }); }}
          title="Delete (or press Delete)"
          className={`nodrag absolute -top-2 -right-2 w-4 h-4 rounded-full bg-[#3a2030] hover:bg-red-500 text-fg hover:text-white text-[9px] leading-none flex items-center justify-center z-10 transition-opacity ${reveal}`}>✕</button>
      )}
      {children}
    </div>
  );
}

// One-shot latch shared with BlueprintCanvas's onConnectEnd. A Ctrl/⌘-click or touch long-press
// disconnect starts a phantom React Flow connection (RF begins a connect on any primary/touch
// pointerdown, ignoring modifiers). When the pointer lifts, onConnectEnd fires — this latch tells
// the canvas to swallow that one event so it doesn't spawn a stray node. Only one canvas is ever
// mounted (it's a modal), so a module-level flag is safe.
export const suppressConnectEnd = { current: false };

/**
 * A connection dot. On top of React Flow's drag-to-connect, it disconnects every wire attached to it
 * on right-click / macOS Ctrl-click (both fire `contextmenu`), Ctrl/⌘ + click, or a touch long-press
 * — so you can cut a link without deleting the boxes, mouse or finger. Disconnect targets THIS dot:
 * a source dot drops the wires leaving it (honouring the branch handle); a target dot drops what
 * points at the box. RF's own handlers run first (it composes onMouseDown/onTouchStart), so wiring
 * still works; onContextMenu isn't used internally so it's free to claim.
 */
function ConnectorDot({ nodeId, type, position, id, style, className }: {
  nodeId: string; type: "source" | "target"; position: Position;
  id?: string; style?: CSSProperties; className: string;
}) {
  const rf = useReactFlow();
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);

  const disconnect = () => {
    const hit = rf.getEdges().filter(e =>
      type === "source"
        ? e.source === nodeId && (e.sourceHandle ?? null) === (id ?? null)
        : e.target === nodeId);
    if (hit.length) rf.deleteElements({ edges: hit.map(e => ({ id: e.id })) });
    return hit.length > 0;
  };
  const clearPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };

  return (
    <Handle type={type} position={position} id={id} style={style} className={className}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); disconnect(); }}
      onMouseDown={e => {
        // Ctrl/⌘ + primary-click → disconnect. RF already began a phantom connection on this same
        // pointerdown, so latch onConnectEnd to swallow the release. (macOS Ctrl-click is button 2 →
        // it never starts a connection and is handled by onContextMenu above instead.)
        if (e.button === 0 && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (disconnect()) suppressConnectEnd.current = true; }
      }}
      onTouchStart={e => {
        const t = e.touches[0]; if (!t) return;
        clearPress();
        press.current = { x: t.clientX, y: t.clientY,
          timer: window.setTimeout(() => { press.current = null; if (disconnect()) suppressConnectEnd.current = true; }, 500) };
      }}
      onTouchMove={e => {
        const t = e.touches[0];
        if (press.current && t && Math.hypot(t.clientX - press.current.x, t.clientY - press.current.y) > 8) clearPress();
      }}
      onTouchEnd={clearPress} />
  );
}

/** Single incoming dot on top (every kind except Start has one). */
const TargetDot = ({ id, kind }: { id: string; kind: BlueprintNodeKind }) =>
  <ConnectorDot nodeId={id} type="target" position={Position.Top} className={`${dot} ${KIND_META[kind].dot}`} />;

/**
 * The two-way fork shared by Yes/No, Repeat, and Try — same shape, different branch words. Left dot
 * is the "keep going / success" path (green), right dot the "stop / other" path (red).
 */
function TwoBranch({ id, data, selected, kind, left, right }:
  { id: string; data: NodeData; selected?: boolean; kind: BlueprintNodeKind; left: string; right: string }) {
  return (
    <NodeBox kind={kind} id={id} selected={selected}>
      <TargetDot id={id} kind={kind} />
      <Editable id={id} data={data} kind={kind} />
      <div className="flex justify-between mt-1.5 text-[9px] font-medium">
        <span className="text-emerald-400">{left} ↙</span><span className="text-red-400">↘ {right}</span>
      </div>
      <ConnectorDot nodeId={id} type="source" id={kind === "condition" ? "yes" : kind === "loop" ? "body" : "ok"} position={Position.Bottom} style={{ left: "22%" }} className={`${dot} !bg-emerald-500`} />
      <ConnectorDot nodeId={id} type="source" id={kind === "condition" ? "no" : kind === "loop" ? "done" : "fail"} position={Position.Bottom} style={{ left: "78%" }} className={`${dot} !bg-red-500`} />
    </NodeBox>
  );
}

export function StartNode({ id, data, selected }: NodeProps) {
  return (
    <NodeBox kind="start" id={id} selected={selected}>
      <Editable id={id} data={data as NodeData} kind="start" />
      <ConnectorDot nodeId={id} type="source" position={Position.Bottom} className={`${dot} ${KIND_META.start.dot}`} />
    </NodeBox>
  );
}

export function ActionNode({ id, data, selected }: NodeProps) {
  return (
    <NodeBox kind="action" id={id} selected={selected}>
      <TargetDot id={id} kind="action" />
      <Editable id={id} data={data as NodeData} kind="action" />
      <ConnectorDot nodeId={id} type="source" position={Position.Bottom} className={`${dot} ${KIND_META.action.dot}`} />
    </NodeBox>
  );
}

export const ConditionNode = ({ id, data, selected }: NodeProps) =>
  <TwoBranch id={id} data={data as NodeData} selected={selected} kind="condition" left="yes" right="no" />;
export const LoopNode = ({ id, data, selected }: NodeProps) =>
  <TwoBranch id={id} data={data as NodeData} selected={selected} kind="loop" left="repeat" right="exit" />;
export const TryNode = ({ id, data, selected }: NodeProps) =>
  <TwoBranch id={id} data={data as NodeData} selected={selected} kind="try" left="ok" right="error" />;

/** "Do these all at once": one incoming, one outgoing dot that you wire to several boxes (fan-out). */
export function ParallelNode({ id, data, selected }: NodeProps) {
  return (
    <NodeBox kind="parallel" id={id} selected={selected}>
      <TargetDot id={id} kind="parallel" />
      <Editable id={id} data={data as NodeData} kind="parallel" />
      <div className="mt-1 text-[9px] text-cyan-400/80">wire to several — all run</div>
      <ConnectorDot nodeId={id} type="source" position={Position.Bottom} className={`${dot} ${KIND_META.parallel.dot}`} />
    </NodeBox>
  );
}

/** A value the program is given up front (path, key, flag). Feeds a step via its one outgoing dot. */
export function ParamNode({ id, data, selected }: NodeProps) {
  return (
    <NodeBox kind="param" id={id} selected={selected}>
      <Editable id={id} data={data as NodeData} kind="param" />
      <ConnectorDot nodeId={id} type="source" position={Position.Bottom} className={`${dot} ${KIND_META.param.dot}`} />
    </NodeBox>
  );
}

/** A labelled section header in the flow — groups the steps that follow it under one phase name. */
export function GroupNode({ id, data, selected }: NodeProps) {
  return (
    <NodeBox kind="group" id={id} selected={selected}>
      <TargetDot id={id} kind="group" />
      <Editable id={id} data={data as NodeData} kind="group" />
      <ConnectorDot nodeId={id} type="source" position={Position.Bottom} className={`${dot} ${KIND_META.group.dot}`} />
    </NodeBox>
  );
}

/** A terminal box: the program is done, this is the result. Incoming dot only — no outputs. */
export function EndNode({ id, data, selected }: NodeProps) {
  return (
    <NodeBox kind="end" id={id} selected={selected}>
      <TargetDot id={id} kind="end" />
      <Editable id={id} data={data as NodeData} kind="end" />
    </NodeBox>
  );
}

/**
 * "Pick a path" (switch): one incoming dot, and one outgoing dot per case plus an `else`, spaced
 * along the bottom. Cases are editable text rows stored in `data.cases`; adding/removing one changes
 * the handle count, so we tell React Flow to recompute the node's handles via updateNodeInternals.
 */
export function SwitchNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  const updateInternals = useUpdateNodeInternals();
  const d = data as NodeData;
  const cases = Array.isArray(d.cases) && d.cases.length ? d.cases : ["A", "B"];
  const commit = (next: string[]) => { rf.updateNodeData(id, { cases: next }); updateInternals(id); };
  const handles = [...cases.map((_, i) => `c${i}`), "else"];

  return (
    <NodeBox kind="switch" id={id} selected={selected}>
      <TargetDot id={id} kind="switch" />
      <Editable id={id} data={d} kind="switch" />
      <div className="mt-1.5 space-y-1">
        {cases.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="text-fuchsia-400 text-[9px] w-3 shrink-0">{i + 1}.</span>
            <input value={c} placeholder="case value"
              onChange={e => commit(cases.map((x, j) => (j === i ? e.target.value : x)))}
              className="nodrag flex-1 min-w-0 px-1 py-0.5 text-[11px] bg-canvas border border-edge-strong rounded outline-none focus:border-fuchsia-500 text-fg" />
            {cases.length > 1 && (
              <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); commit(cases.filter((_, j) => j !== i)); }}
                title="Remove case" className="nodrag text-dim hover:text-red-300 text-[11px] leading-none shrink-0">×</button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); commit([...cases, ""]); }}
            className="nodrag text-[10px] text-fuchsia-400/80 hover:text-fuchsia-300">+ case</button>
          <span className="text-[9px] text-slate-400">else ↘</span>
        </div>
      </div>
      {handles.map((h, i) => (
        <ConnectorDot key={h} nodeId={id} type="source" id={h} position={Position.Bottom}
          style={{ left: `${((i + 1) / (handles.length + 1)) * 100}%` }}
          className={`${dot} ${h === "else" ? "!bg-slate-400" : "!bg-fuchsia-500"}`} />
      ))}
    </NodeBox>
  );
}

/**
 * Transient endpoint at the end of a dragged-off wire while the kind picker is open. It is NOT a box
 * — just the line's terminus: a single small pulsing dot the real edge connects to, so the "string"
 * stays frozen in place after you release while you pick what it becomes. No card, border, or text,
 * because no box should appear until the user actually chooses a kind. BlueprintCanvas converts this
 * to the chosen kind on pick; it's stripped from the saved/serialized graph, so it never leaks in.
 */
export function GhostNode() {
  return (
    <div className="w-3 h-3">
      <Handle type="target" position={Position.Top}
        className="!w-3 !h-3 !min-w-0 !min-h-0 !rounded-full !border-2 !border-canvas !bg-slate-400 animate-pulse" />
    </div>
  );
}

export const nodeTypes = {
  start: StartNode, action: ActionNode, condition: ConditionNode, loop: LoopNode,
  switch: SwitchNode, parallel: ParallelNode, try: TryNode, param: ParamNode,
  group: GroupNode, end: EndNode, ghost: GhostNode,
};

let seq = 0;
/** Fresh node id, distinct within a session. */
export const nid = () => `n_${Date.now().toString(36)}_${seq++}`;

/** Build a new node of the given kind at a position, starting blank (ready to double-click). */
export function makeNode(kind: BlueprintNodeKind, position: { x: number; y: number }, label = ""): BlueprintNode {
  return { id: nid(), type: kind, position, data: kind === "switch" ? { label, cases: ["A", "B"] } : { label } };
}
