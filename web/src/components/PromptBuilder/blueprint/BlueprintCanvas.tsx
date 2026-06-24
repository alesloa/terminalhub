import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, ControlButton, MiniMap, SelectionMode,
  useNodesState, useEdgesState, useReactFlow, useUpdateNodeInternals,
  type Node, type Edge, type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { BlueprintGraph, BlueprintNodeKind, AiChatMessage, BlueprintOp } from "../../../api/types";
import { useToasts } from "../../../store/toasts";
import { AiProviderSettings } from "../../Scm/AiProviderSettings";
import { nodeTypes, makeNode, mkEdge, EDGE_DEFAULTS, suppressConnectEnd, KIND_META, ADDABLE_KINDS, DEFAULT_HANDLE, nid } from "./nodes";
import { graphToSpec } from "./spec";
import { BlueprintChat } from "./BlueprintChat";
import { signature, loadDraft, saveDraft, clearDraft, type BlueprintDraft } from "./draft";
import { STATS_BAR_HEIGHT } from "../../SystemStatsBar";

// Convert/delete bridging: a branching kind (many outputs) can't be auto-bridged on delete, and an
// "end" kind has no outputs at all.
const BRANCHING = new Set<string>(["condition", "loop", "try", "switch"]);

// Start is the single entry point — not deletable (there's no way to re-add it, and a flow with no
// entry is meaningless), matching how trigger nodes work in n8n/Make.
const START_NODE: Node = { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" }, deletable: false };

// React Flow → our opaque graph shape (what we serialize, save, and load). Only the fields the
// canvas owns are kept; React Flow's transient view state (selected, dragging…) is dropped. The
// transient "ghost" placeholder (and any wire to it) is excluded so it never reaches a blueprint.
function toGraph(nodes: Node[], edges: Edge[]): BlueprintGraph {
  const real = nodes.filter(n => n.type !== "ghost");
  const ids = new Set(real.map(n => n.id));
  return {
    nodes: real.map(n => ({
      id: n.id,
      type: (n.type as BlueprintNodeKind) ?? "action",
      position: n.position,
      data: {
        label: String((n.data as any)?.label ?? ""),
        description: (n.data as any)?.description,
        ...(Array.isArray((n.data as any)?.cases) ? { cases: (n.data as any).cases } : {}),
      },
    })),
    edges: edges.filter(e => ids.has(e.source) && ids.has(e.target))
      .map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
  };
}

// Signature of a pristine canvas (just the Start node, no name, no chat). A draft equal to this is
// "empty" — never worth persisting or offering to resume. Computed from toGraph so it can't drift.
const EMPTY_SIG = signature("", toGraph([START_NODE], []), []);

// Right-click context menu — over a node (convert/delete) or over an edge (disconnect).
type Menu =
  | { kind: "node"; id: string; type: BlueprintNodeKind; x: number; y: number }
  | { kind: "edge"; id: string; x: number; y: number };

// Pending "dragged a dot onto empty canvas": a placeholder "ghost" box + a real wire are already on
// the canvas (so the string stays visible); we hold its id + the picker position until the user
// picks what kind it becomes.
type Drop = { x: number; y: number; ghostId: string };

// --- AI canvas-ops helpers (pure) ----------------------------------------------------------------
// The floating chat can return ops that build/edit the graph. These translate a kind into its valid
// source handles (so the AI's branch choices map onto real wire handles) and lay out freshly-added
// nodes without disturbing the user's manual placement.

/** The source-handle ids a kind exposes: a fixed pair for forks, the case list (+else) for a switch,
 *  [] for End (no outputs), or null for single-output kinds (action/start/parallel/group/param). */
function sourceHandleSet(node: Node): string[] | null {
  const kind = node.type as BlueprintNodeKind;
  switch (kind) {
    case "condition": return ["yes", "no"];
    case "loop": return ["body", "done"];
    case "try": return ["ok", "fail"];
    case "switch": {
      const cs = Array.isArray((node.data as any)?.cases) && (node.data as any).cases.length ? (node.data as any).cases : ["A", "B"];
      return [...cs.map((_: string, i: number) => `c${i}`), "else"];
    }
    case "end": return [];
    default: return null;
  }
}

/** Map a model-supplied branch onto a real source handle: honour it if valid for the kind, else fall
 *  back to the kind's default leg; single-output kinds always get null (no handle). */
function resolveSourceHandle(node: Node, branch?: string | null): string | null {
  const set = sourceHandleSet(node);
  if (set === null) return null;
  if (branch && set.includes(branch)) return branch;
  return DEFAULT_HANDLE[node.type as BlueprintNodeKind] ?? set[0] ?? null;
}

/** Position each freshly-added node below the card it hangs off (staggering siblings so they don't
 *  overlap); nodes with no placed parent stack to the right. Mutates positions in place. Existing
 *  nodes are never moved, so the user's manual layout is preserved. */
function layoutNewNodes(nodes: Node[], edges: Edge[], newIds: Set<string>) {
  if (!newIds.size) return;
  const V_GAP = 120, H_GAP = 240;
  const placed = new Set(nodes.filter(n => !newIds.has(n.id)).map(n => n.id));
  const childCount = new Map<string, number>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const n of nodes) {
      if (placed.has(n.id)) continue;
      const inEdge = edges.find(e => e.target === n.id && placed.has(e.source));
      if (!inEdge) continue;
      const parent = nodes.find(p => p.id === inEdge.source)!;
      const idx = childCount.get(parent.id) ?? 0;
      childCount.set(parent.id, idx + 1);
      n.position = { x: parent.position.x + idx * H_GAP, y: parent.position.y + V_GAP };
      placed.add(n.id);
      progress = true;
    }
  }
  // Orphans (no path to a placed node): stack to the right of everything already placed.
  const xs = nodes.filter(n => placed.has(n.id)).map(n => n.position.x);
  let x = (xs.length ? Math.max(...xs) : 0) + H_GAP, y = 0;
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    n.position = { x, y };
    y += V_GAP;
    placed.add(n.id);
  }
}

export function BlueprintCanvas({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <Inner onClose={onClose} onBack={onBack} />
    </ReactFlowProvider>
  );
}

function Inner({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const push = useToasts(s => s.push);
  const { screenToFlowPosition, deleteElements } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([START_NODE]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [blueprintId, setBlueprintId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [engineId, setEngineId] = useState<string | null>(null);
  const [targetTool, setTargetTool] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  // The active canvas tool — what a plain left-drag / one finger does, and the cursor shown:
  //   pointer  normal arrow; click-selects + drags boxes (the neutral default on desktop)
  //   pan      grab hand; drag / one finger moves the canvas (the default on touch, for scrolling)
  //   select   crosshair; drag / one finger draws a box-select
  // Middle-drag and Space always pan; Shift-drag always box-selects; Shift/⌘-click adds — in any tool.
  const [tool, setTool] = useState<"pointer" | "pan" | "select">(() => {
    try { return window.matchMedia("(pointer: coarse)").matches ? "pan" : "pointer"; } catch { return "pointer"; }
  });
  const [polished, setPolished] = useState("");
  // The AI-assistant transcript lives here (not inside BlueprintChat) so it saves/loads with the
  // blueprint — a saved prompt session reopens with its whole conversation intact.
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([]);
  // One-level undo for the AI assistant's last canvas edit: snapshot of nodes/edges taken right
  // before applying a batch of ops. Cleared on any manual structural change, New, or load.
  const [aiUndo, setAiUndo] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);

  // Unsaved-work recovery. `baseline` is the signature of the last saved/loaded state; the canvas is
  // "dirty" when the live content drifts from it. A recovered draft (after a refresh/crash) surfaces
  // through `restore` as a resume prompt; `closeConfirm` gates the ✕ when there are unsaved changes.
  // `ready` holds autosave until we've checked for an existing draft on mount (so the empty canvas's
  // first render can't wipe it). `skipFlush` suppresses the unmount safety-flush after a deliberate
  // close/discard already resolved the draft.
  const [baseline, setBaseline] = useState(EMPTY_SIG);
  const [restore, setRestore] = useState<BlueprintDraft | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [ready, setReady] = useState(false);
  const skipFlush = useRef(false);

  const { data: builder } = useQuery({ queryKey: ["ai", "builder"], queryFn: () => api.ai.builder() });
  const { data: saved } = useQuery({ queryKey: ["blueprints"], queryFn: () => api.blueprints.list() });
  const engines = builder?.engines ?? [];
  const targetTools = builder?.targetTools ?? [];
  const noEngines = !!builder && engines.length === 0;
  const selectedDeletable = nodes.filter(n => n.selected && n.type !== "start");

  // Seed engine + target tool from what the user actually has, and keep them valid as settings change.
  useEffect(() => {
    if (!builder) return;
    setEngineId(prev => (prev && engines.some(e => e.id === prev) ? prev : builder.defaultEngineId));
    setTargetTool(prev => {
      if (prev && targetTools.includes(prev)) return prev;
      const eng = engines.find(e => e.id === builder.defaultEngineId);
      return eng?.tool ?? targetTools[0] ?? "";
    });
  }, [builder]); // eslint-disable-line react-hooks/exhaustive-deps

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const spec = useMemo(() => graphToSpec(graph), [graph]);
  // Cards the user has highlighted — passed to the chat so "edit this" / "add after this" resolves.
  const selectedIds = useMemo(() => nodes.filter(n => n.selected && n.type !== "ghost").map(n => n.id), [nodes]);

  // Live content signature → "dirty" when it drifts from the last saved/loaded baseline.
  const curSig = useMemo(() => signature(name, graph, chatMessages), [name, graph, chatMessages]);
  const dirty = curSig !== baseline;

  // The full working state, as it gets persisted. baselineSig rides along so a resumed draft knows
  // what counts as "saved" and dirty can fall back to false if the user reverts their edits.
  const snapshot = useCallback((): BlueprintDraft => ({
    blueprintId, name, graph, chat: chatMessages, engineId, targetTool, polished, baselineSig: baseline, savedAt: Date.now(),
  }), [blueprintId, name, graph, chatMessages, engineId, targetTool, polished, baseline]);

  // Refs mirror the latest values so the unmount cleanup (which closes over mount-time values) reads
  // current state, not stale.
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
  const curSigRef = useRef(curSig); curSigRef.current = curSig;

  // On mount, recover a draft left by a prior refresh/crash/accidental close, then release autosave.
  useEffect(() => {
    const d = loadDraft();
    if (d && signature(d.name, d.graph, d.chat) !== EMPTY_SIG) setRestore(d);
    setReady(true);
  }, []);

  // Autosave (debounced): mirror the live state to localStorage. Hold off until the draft-check has
  // run and while the resume prompt is up; an empty canvas clears any stale draft instead.
  useEffect(() => {
    if (!ready || restore) return;
    const t = window.setTimeout(() => {
      if (curSig === EMPTY_SIG) clearDraft(); else saveDraft(snapshot());
    }, 500);
    return () => window.clearTimeout(t);
  }, [ready, restore, curSig, snapshot]);

  // Hard refresh / tab close can fire before the debounce — flush synchronously so nothing is lost.
  useEffect(() => {
    const flush = () => { if (ready && !restore && curSigRef.current !== EMPTY_SIG) saveDraft(snapshotRef.current()); };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", flush); };
  }, [ready, restore]);

  // Unmount safety net: an unguarded close (re-toggling the launcher, parent teardown) skips the ✕
  // prompt, so flush the draft here unless a deliberate close/discard already resolved it.
  useEffect(() => () => {
    if (skipFlush.current || curSigRef.current === EMPTY_SIG) return;
    saveDraft(snapshotRef.current());
  }, []);

  // Reject self-links and duplicates (same source-handle → same target) so the graph stays sane.
  const isValidConnection = useCallback((c: Connection | Edge) =>
    c.source !== c.target &&
    !edges.some(e => e.source === c.source && e.target === c.target && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)),
  [edges]);

  const onConnect = useCallback((c: Connection) => {
    setEdges(eds => eds.concat(mkEdge(c.source!, c.target!, c.sourceHandle ?? null) as Edge));
    setAiUndo(null);
  }, [setEdges]);

  // Drag off a node's handle and drop on empty canvas → drop a placeholder "ghost" box there and
  // wire it up immediately, so the string you pulled off stays put; then open a kind picker so the
  // user chooses what that box becomes (no modifier needed). state typed `any`: React Flow's
  // FinalConnectionState shape shifts across minor versions; we only read isValid/fromNode/fromHandle.
  const onConnectEnd = useCallback((event: any, state: any) => {
    // A dot disconnect (Ctrl/⌘-click or touch long-press) started a phantom connection; swallow the
    // release so it doesn't drop a stray ghost.
    if (suppressConnectEnd.current) { suppressConnectEnd.current = false; return; }
    if (state?.isValid || !state?.fromNode) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const pos = screenToFlowPosition({ x: point.clientX, y: point.clientY });
    const ghostId = nid();
    // The ghost is a 12px endpoint dot; nudge so it centres on the exact release point.
    setNodes(nds => nds.concat({ id: ghostId, type: "ghost", position: { x: pos.x - 6, y: pos.y - 6 }, data: { label: "" }, draggable: false, selectable: false, deletable: false } as Node));
    setEdges(eds => eds.concat(mkEdge(state.fromNode.id, ghostId, state.fromHandle?.id ?? null) as Edge));
    setMenu(null);
    setDrop({ x: point.clientX, y: point.clientY, ghostId });
  }, [screenToFlowPosition, setNodes, setEdges]);

  // The user picked a kind: turn the ghost into a real box of that kind (the wire is already there).
  const choosePending = (kind: BlueprintNodeKind) => {
    if (!drop) return;
    const gid = drop.ghostId;
    setNodes(nds => nds.map(n => (n.id === gid
      ? { ...n, type: kind, draggable: true, selectable: true, deletable: true, selected: true,
          data: kind === "switch" && !Array.isArray((n.data as any).cases) ? { ...n.data, cases: ["A", "B"] } : n.data }
      : { ...n, selected: false }) as Node));
    updateNodeInternals(gid);
    setDrop(null);
    setAiUndo(null);
  };

  // Clicked away without picking → remove the ghost and its wire, leaving the canvas as it was.
  const cancelPending = () => {
    if (!drop) return;
    const gid = drop.ghostId;
    setNodes(nds => nds.filter(n => n.id !== gid));
    setEdges(eds => eds.filter(e => e.source !== gid && e.target !== gid));
    setDrop(null);
  };

  // Industry-standard reconnect-on-delete: removing a linear step bridges its predecessor(s) to its
  // successor so the chain stays whole. A branching node (condition/loop/try/switch) forks several
  // ways — bridging all of them into the parent would be wrong, so it just leaves a gap (delete its
  // branch edges and move on). An End has no successor to bridge to either.
  const onNodesDelete = useCallback((deleted: Node[]) => {
    setAiUndo(null);
    setEdges(eds => deleted.reduce((acc, node) => {
      const incoming = acc.filter(e => e.target === node.id);
      const outgoing = acc.filter(e => e.source === node.id);
      const drop = new Set([...incoming, ...outgoing].map(e => e.id));
      const remaining = acc.filter(e => !drop.has(e.id));
      if (BRANCHING.has(node.type ?? "") || outgoing.length !== 1) return remaining;
      const target = outgoing[0].target;
      const existing = new Set(remaining.map(e => `${e.source}|${e.sourceHandle ?? ""}|${e.target}`));
      const bridges = incoming
        .filter(inc => inc.source !== target && !existing.has(`${inc.source}|${inc.sourceHandle ?? ""}|${target}`))
        .map(inc => mkEdge(inc.source, target, inc.sourceHandle ?? null) as Edge);
      return [...remaining, ...bridges];
    }, eds));
  }, [setEdges]);

  // Toolbar adds drop into the centre of the visible canvas (not stacked off-screen) and select the
  // new node so you can immediately rename or delete it.
  const addNode = (kind: BlueprintNodeKind) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const pos = r ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 };
    const n = makeNode(kind, pos);
    const fresh = { id: n.id, type: n.type, position: n.position, data: n.data, selected: true } as Node;
    setNodes(nds => nds.map(x => ({ ...x, selected: false }) as Node).concat(fresh));
    setAiUndo(null);
  };

  // Right-click → change a node into another kind. Outgoing edges snap to the new kind's default
  // branch handle (e.g. a fresh condition's edges go down the "yes" leg); converting to a single-out
  // kind clears the handle; converting to End (no outputs) drops its outgoing edges entirely. A
  // switch gets default cases so it renders branches. Start can't be converted. updateNodeInternals
  // tells React Flow to recompute handles, since the handle set changed with the kind.
  const convert = (id: string, type: BlueprintNodeKind) => {
    setNodes(nds => nds.map(n => {
      if (n.id !== id) return n;
      const data = type === "switch" && !Array.isArray((n.data as any).cases)
        ? { ...n.data, cases: ["A", "B"] } : n.data;
      return { ...n, type, data };
    }));
    const handle = DEFAULT_HANDLE[type] ?? null; // branch handles are kind-specific, so snap, don't keep
    setEdges(eds => eds.flatMap(e =>
      e.source !== id ? [e]
        : type === "end" ? []                                  // End has no outputs
        : [{ ...e, sourceHandle: handle }]));
    updateNodeInternals(id);
    setMenu(null);
    setAiUndo(null);
  };

  // Apply a batch of canvas ops the AI assistant returned. Builds the next nodes/edges arrays
  // imperatively from the current state (so node + edge edits in one batch stay consistent), then
  // commits once. Snapshots first for one-click "Undo AI". New nodes get a tempId→real-id mapping,
  // are positioned under their parent, and end up selected so the change is obvious. Invalid ops
  // (self-link, dup wire, deleting/recreating Start, connecting out of an End) are skipped.
  const applyOps = useCallback((ops: BlueprintOp[]) => {
    if (!ops.length) return;
    setAiUndo({ nodes, edges });

    let nextNodes: Node[] = nodes.map(n => ({ ...n }));
    let nextEdges: Edge[] = edges.map(e => ({ ...e }));
    const idMap = new Map<string, string>(); // model tempId → real node id
    const ref = (r: string) => idMap.get(r) ?? r;
    const recompute = new Set<string>(); // nodes whose handle set changed → updateNodeInternals
    const find = (id: string) => nextNodes.find(n => n.id === id);

    for (const op of ops) {
      if (op.op === "add") {
        if (op.kind === "start") continue; // never recreate the single entry point
        const base = makeNode(op.kind, { x: 0, y: 0 }, op.label ?? "");
        idMap.set(op.tempId, base.id);
        const data: any = { ...base.data };
        if (op.description?.trim()) data.description = op.description.trim();
        if (op.kind === "switch" && Array.isArray(op.cases) && op.cases.length) data.cases = op.cases;
        nextNodes.push({ id: base.id, type: op.kind, position: { x: 0, y: 0 }, data } as Node);
      } else if (op.op === "update") {
        const node = find(ref(op.id));
        if (!node) continue;
        if (node.type === "start") { // allow relabelling Start, never retype it
          node.data = { ...node.data,
            ...(op.label !== undefined ? { label: op.label } : {}),
            ...(op.description !== undefined ? { description: op.description } : {}) } as any;
          continue;
        }
        const newKind = op.kind && op.kind !== "start" ? op.kind : (node.type as BlueprintNodeKind);
        const kindChanged = newKind !== node.type;
        const data: any = { ...node.data };
        if (op.label !== undefined) data.label = op.label;
        if (op.description !== undefined) data.description = op.description;
        if (newKind === "switch") {
          data.cases = Array.isArray(op.cases) && op.cases.length ? op.cases
            : Array.isArray(data.cases) && data.cases.length ? data.cases : ["A", "B"];
          recompute.add(node.id);
        } else if (op.cases !== undefined) {
          delete data.cases; // cases only matter on a switch
        }
        node.type = newKind;
        node.data = data;
        if (kindChanged) { // mirror convert(): snap outgoing edges to the new kind's default handle
          recompute.add(node.id);
          const handle = DEFAULT_HANDLE[newKind] ?? null;
          nextEdges = nextEdges.flatMap(e =>
            e.source !== node.id ? [e]
              : newKind === "end" ? []                 // End has no outputs
              : [{ ...e, sourceHandle: handle }]);
        }
      } else if (op.op === "delete") {
        const node = find(ref(op.id));
        if (!node || node.type === "start") continue; // Start is never deletable
        nextNodes = nextNodes.filter(n => n.id !== node.id);
        nextEdges = nextEdges.filter(e => e.source !== node.id && e.target !== node.id);
      } else if (op.op === "disconnect") {
        const from = ref(op.from), to = ref(op.to);
        nextEdges = nextEdges.filter(e =>
          !(e.source === from && e.target === to && (op.branch == null || (e.sourceHandle ?? null) === op.branch)));
      } else if (op.op === "connect") {
        const from = ref(op.from), to = ref(op.to);
        if (from === to) continue; // no self-links
        const src = find(from), tgt = find(to);
        if (!src || !tgt || tgt.type === "start" || src.type === "end") continue; // End has no outputs
        const handle = resolveSourceHandle(src, op.branch);
        if (nextEdges.some(e => e.source === from && e.target === to && (e.sourceHandle ?? null) === (handle ?? null))) continue; // dup
        nextEdges.push(mkEdge(from, to, handle) as Edge);
      }
    }

    const newIds = new Set(idMap.values());
    layoutNewNodes(nextNodes, nextEdges, newIds);
    if (newIds.size) nextNodes = nextNodes.map(n => ({ ...n, selected: newIds.has(n.id) }));

    setNodes(nextNodes);
    setEdges(nextEdges);
    recompute.forEach(id => updateNodeInternals(id));
  }, [nodes, edges, setNodes, setEdges, updateNodeInternals]);

  // Revert the AI assistant's last batch of edits in one click (single level).
  const undoAi = () => { if (aiUndo) { setNodes(aiUndo.nodes); setEdges(aiUndo.edges); setAiUndo(null); } };

  // Drop a card from the chat's selection chips (the ×): just clear its selected flag. A view-only
  // change — it doesn't touch the graph or the AI-undo snapshot.
  const deselectNode = useCallback((id: string) => {
    setNodes(nds => nds.map(n => (n.id === id ? { ...n, selected: false } : n)) as Node[]);
  }, [setNodes]);

  const onNodeContextMenu = useCallback((e: ReactMouseEvent, node: Node) => {
    e.preventDefault();
    setMenu({ kind: "node", id: node.id, type: (node.type as BlueprintNodeKind) ?? "action", x: e.clientX, y: e.clientY });
  }, []);

  // Disconnect a wire (the edge) without touching the boxes: right-click it for a Disconnect menu,
  // or Ctrl/⌘-click it to cut it instantly. Plain click just closes any open menu.
  const onEdgeContextMenu = useCallback((e: ReactMouseEvent, edge: Edge) => {
    e.preventDefault();
    setMenu({ kind: "edge", id: edge.id, x: e.clientX, y: e.clientY });
  }, []);
  const onEdgeClick = useCallback((e: ReactMouseEvent, edge: Edge) => {
    if (e.ctrlKey || e.metaKey) { e.stopPropagation(); deleteElements({ edges: [{ id: edge.id }] }); }
    setMenu(null);
  }, [deleteElements]);

  const onEngine = (id: string) => {
    setEngineId(id || null);
    const eng = engines.find(e => e.id === id);
    if (eng) setTargetTool(eng.tool);
  };

  const savedSig = useRef(""); // signature of exactly what the last save sent — the new baseline
  const save = useMutation({
    mutationFn: async () => {
      const graph = toGraph(nodes, edges);
      const nm = name.trim() || "Untitled blueprint";
      savedSig.current = signature(nm, graph, chatMessages); // capture the sent content, not later live edits
      return blueprintId
        ? (await api.blueprints.update(blueprintId, { name: nm, graph, chat: chatMessages })).blueprint
        : (await api.blueprints.create(nm, graph, chatMessages)).blueprint;
    },
    onSuccess: bp => {
      setBlueprintId(bp.id); setName(bp.name);
      setBaseline(savedSig.current); // saved → no longer dirty (relative to what was actually saved)
      qc.invalidateQueries({ queryKey: ["blueprints"] }); push("Blueprint saved");
    },
    onError: (e: Error) => push(e.message),
  });

  const load = async (id: string) => {
    try {
      const { blueprint } = await api.blueprints.get(id);
      setNodes(blueprint.graph.nodes.map(n => ({
        id: n.id, type: n.type, position: n.position, data: { ...n.data }, ...(n.type === "start" ? { deletable: false } : {}),
      })) as Node[]);
      setEdges(blueprint.graph.edges.map(e => ({ ...mkEdge(e.source, e.target, e.sourceHandle ?? null), id: e.id })) as Edge[]);
      setBlueprintId(blueprint.id); setName(blueprint.name); setOpenOpen(false); setPolished("");
      setChatMessages(blueprint.chat ?? []);
      setBaseline(signature(blueprint.name, blueprint.graph, blueprint.chat ?? []));
      setAiUndo(null);
    } catch (e) { push((e as Error).message); }
  };

  // Rehydrate the canvas from a recovered draft (same shape as load, but from localStorage, and it
  // restores the chosen engine/target/polished too). baseline = the draft's saved baseline, so a
  // resumed draft is correctly flagged dirty until the user saves it.
  const applyDraft = (d: BlueprintDraft) => {
    setNodes(d.graph.nodes.map(n => ({
      id: n.id, type: n.type, position: n.position, data: { ...n.data }, ...(n.type === "start" ? { deletable: false } : {}),
    })) as Node[]);
    setEdges(d.graph.edges.map(e => ({ ...mkEdge(e.source, e.target, e.sourceHandle ?? null), id: e.id })) as Edge[]);
    setBlueprintId(d.blueprintId); setName(d.name); setChatMessages(d.chat); setPolished(d.polished);
    if (d.engineId) setEngineId(d.engineId);
    if (d.targetTool) setTargetTool(d.targetTool);
    setBaseline(d.baselineSig || EMPTY_SIG);
    setAiUndo(null);
  };

  const resumeDraft = () => { if (restore) applyDraft(restore); setRestore(null); };
  const startFresh = () => { setRestore(null); clearDraft(); newBlueprint(); };

  const remove = useMutation({
    mutationFn: (id: string) => api.blueprints.remove(id),
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ["blueprints"] }); if (id === blueprintId) newBlueprint(); },
    onError: (e: Error) => push(e.message),
  });

  const newBlueprint = () => {
    setNodes([START_NODE]); setEdges([]); setBlueprintId(null); setName(""); setPolished(""); setChatMessages([]);
    setBaseline(EMPTY_SIG); setAiUndo(null); clearDraft();
  };

  // ✕ close: if there's unsaved work, ask (Save / Discard / Cancel); otherwise drop the draft and go.
  const attemptClose = () => { if (dirty) { setCloseConfirm(true); return; } skipFlush.current = true; clearDraft(); onClose(); };
  const confirmDiscard = () => { skipFlush.current = true; clearDraft(); setCloseConfirm(false); onClose(); };
  const confirmSave = () => save.mutate(undefined, { onSuccess: () => { skipFlush.current = true; clearDraft(); setCloseConfirm(false); onClose(); } });
  // ← Back leaves quietly to the chooser; flush first so the draft is current for the resume prompt.
  const handleBack = () => { if (curSig !== EMPTY_SIG) saveDraft(snapshot()); onBack(); };

  const polish = useMutation({
    mutationFn: () => api.ai.buildFromBlueprint(spec, targetTool, engineId ?? undefined),
    onSuccess: d => setPolished(d.prompt),
    onError: (e: Error) => push(e.message),
  });

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); push("Copied"); }
    catch { push("Couldn't copy — select the text manually"); }
  };

  const btn = "px-2.5 py-1 text-xs rounded bg-elevated hover:bg-edge text-fg border border-edge-strong disabled:opacity-40 disabled:hover:bg-elevated";
  const sel = "px-2 py-1 text-xs bg-panel border border-edge rounded outline-none focus:border-blue-500 text-fg disabled:opacity-50";
  const Sep = () => <span className="w-px h-5 bg-edge mx-1" />;

  return (
    <div style={{ bottom: STATS_BAR_HEIGHT }} className="fixed left-0 right-0 top-0 z-[80] bg-canvas flex flex-col"
      onClick={() => { if (menu) setMenu(null); if (openOpen) setOpenOpen(false); if (addOpen) setAddOpen(false); }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 h-12 shrink-0 border-b border-edge">
        <button onClick={handleBack} title="Back" className="text-muted hover:text-bright text-sm px-1">←</button>
        <span className="text-sm font-semibold text-bright">Blueprint</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="untitled"
          className="ml-1 w-40 px-2 py-1 text-xs bg-panel border border-edge rounded outline-none focus:border-blue-500 text-fg" />
        <Sep />
        <button onClick={() => addNode("action")} className={btn}>+ {KIND_META.action.name}</button>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setAddOpen(o => !o)} className={btn}>+ Add ▾</button>
          {addOpen && (
            <div className="absolute left-0 mt-1 w-52 bg-panel border border-edge rounded shadow-xl z-20 py-1">
              <KindList kinds={ADDABLE_KINDS} onPick={k => { addNode(k); setAddOpen(false); }} />
            </div>
          )}
        </div>
        <button onClick={() => deleteElements({ nodes: selectedDeletable.map(n => ({ id: n.id })) })}
          disabled={selectedDeletable.length === 0} title="Delete selected (or press Delete)"
          className={`${btn} hover:!bg-red-600/30 hover:!border-red-500/50`}>Delete{selectedDeletable.length > 1 ? ` (${selectedDeletable.length})` : ""}</button>
        <Sep />
        <button onClick={() => save.mutate()} disabled={save.isPending} className={btn}>{save.isPending ? "Saving…" : "Save"}</button>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setOpenOpen(o => !o)} className={btn}>Open ▾</button>
          {openOpen && (
            <div className="absolute left-0 mt-1 w-64 max-h-72 overflow-auto bg-panel border border-edge rounded shadow-xl z-20">
              {(saved?.blueprints ?? []).length === 0 && <div className="px-3 py-2 text-xs text-dim">No saved blueprints yet.</div>}
              {(saved?.blueprints ?? []).map(b => (
                <div key={b.id} className="flex items-center hover:bg-elevated">
                  <button onClick={() => load(b.id)} className="flex-1 text-left px-3 py-1.5 text-xs text-fg truncate">{b.name}</button>
                  <button onClick={() => remove.mutate(b.id)} title="Delete" className="px-2 text-dim hover:text-red-300">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={newBlueprint} className={btn}>New</button>
        {aiUndo && (
          <button onClick={undoAi} title="Undo the AI assistant's last change to the canvas"
            className={`${btn} text-blue-300`}>↩ Undo AI</button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] text-dim">for</span>
          <select value={targetTool} onChange={e => setTargetTool(e.target.value)} disabled={targetTools.length === 0}
            title="The coding agent this prompt is written for" className={`${sel} max-w-[140px]`}>
            {targetTools.length === 0 && <option value="">none</option>}
            {targetTools.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-[10px] text-dim">build with</span>
          <select value={engineId ?? ""} onChange={e => onEngine(e.target.value)} disabled={engines.length === 0}
            title="The AI that writes the prompt" className={`${sel} max-w-[150px]`}>
            {engines.length === 0 && <option value="">none available</option>}
            {engines.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <button onClick={() => setSettingsOpen(true)} title="AI providers & API keys" className={btn}>⚙</button>
          <button onClick={attemptClose} title="Close" className="text-dim hover:text-fg px-1">✕</button>
        </div>
      </div>

      {/* Canvas + side panel */}
      <div className="flex-1 flex min-h-0">
        <div ref={wrapRef} className={`flex-1 relative bp-tool-${tool}`}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
            onConnect={onConnect} onConnectEnd={onConnectEnd} onNodesDelete={onNodesDelete}
            isValidConnection={isValidConnection}
            onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu} onEdgeClick={onEdgeClick}
            onPaneClick={() => setMenu(null)} onNodeClick={() => setMenu(null)}
            nodeTypes={nodeTypes} defaultEdgeOptions={EDGE_DEFAULTS} deleteKeyCode={["Backspace", "Delete"]}
            connectOnClick={false} colorMode="dark" fitView proOptions={{ hideAttribution: true }}
            panOnDrag={tool === "pan" ? [0, 1] : [1]} selectionOnDrag={tool === "select"}
            selectionMode={SelectionMode.Partial} selectionKeyCode="Shift"
            multiSelectionKeyCode={["Shift", "Meta", "Control"]} panActivationKeyCode="Space">
            <Background gap={18} color="rgb(var(--tr-elevated))" />
            <Controls position="top-left" className="!bg-panel !border-edge">
              {/* Tap-friendly tool palette (works without a trackpad on tablets): pick what a plain
                  drag / one finger does, and the cursor. The active one is highlighted. */}
              <ControlButton onClick={() => setTool("pointer")} title="Pointer — normal cursor; click to select, drag a box to move it"
                className={tool === "pointer" ? "!bg-blue-600/50 !text-blue-100" : "!text-fg"}><IconPointer /></ControlButton>
              <ControlButton onClick={() => setTool("pan")} title="Move — drag / one finger pans the canvas"
                className={tool === "pan" ? "!bg-blue-600/50 !text-blue-100" : "!text-fg"}><IconHand /></ControlButton>
              <ControlButton onClick={() => setTool("select")} title="Select — drag / one finger draws a box-select"
                className={tool === "select" ? "!bg-blue-600/50 !text-blue-100" : "!text-fg"}><IconMarquee /></ControlButton>
            </Controls>
            <MiniMap position="top-right" pannable zoomable className="!bg-panel" maskColor="rgba(0,0,0,0.5)"
              nodeColor={n => KIND_META[n.type as BlueprintNodeKind]?.mini ?? "rgb(var(--tr-accent))"} />
          </ReactFlow>
          <div className="absolute bottom-3 left-3 text-[10px] text-dim pointer-events-none max-w-[460px] space-y-0.5">
            <div>Drag a <span className="text-muted">dot</span> onto another box to connect them, or onto empty canvas to <span className="text-muted">pick</span> the next box. Double-click to edit · right-click a box to change type · <span className="text-muted">right-click / ⌘Ctrl-click / long-press a dot</span> to disconnect.</div>
            <div>Top-left tools: <span className="text-muted">Pointer</span> (select &amp; move) · <span className="text-muted">Move</span> (pan) · <span className="text-muted">Select</span> (drag a box to pick many). Or <span className="text-muted">Shift-drag</span> to box-select &amp; <span className="text-muted">Shift/⌘-click</span> to add, then <span className="text-muted">Delete</span>. <span className="text-muted">Middle-drag</span> / <span className="text-muted">Space</span> always pans.</div>
          </div>

          {/* Floating AI assistant — a screen-space sibling of <ReactFlow>, so canvas pan/zoom never
              moves or scales it. Draggable, defaults to the bottom-right corner of the canvas. It can
              build/edit the graph: its ops flow back through onOps → applyOps. */}
          <BlueprintChat spec={spec} targetTool={targetTool} graph={graph} selected={selectedIds}
            messages={chatMessages} setMessages={setChatMessages} onOps={applyOps} onDeselect={deselectNode}
            onOpenSettings={() => setSettingsOpen(true)} />
        </div>

        <aside className="w-[340px] shrink-0 border-l border-edge flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-edge">
            <span className="text-xs text-fg">Plan for the agent</span>
            <button onClick={() => copy(spec)} className="text-[11px] text-muted hover:text-bright">Copy</button>
          </div>
          <pre className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[11px] font-mono leading-snug text-fg whitespace-pre-wrap selection:bg-blue-500/40">{spec}</pre>

          <div className="shrink-0 border-t border-edge p-3 space-y-2">
            {noEngines && (
              <p className="text-[11px] text-amber-300/90">No AI engine — install <code>claude</code>/<code>codex</code> or add a key in ⚙ to use Polish.</p>
            )}
            <button onClick={() => polish.mutate()} disabled={noEngines || !targetTool || polish.isPending}
              className="w-full px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
              {polish.isPending ? "Polishing…" : "Polish through AI ⚡"}
            </button>
            {polished && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-muted">Polished prompt</span>
                  <button onClick={() => copy(polished)} className="text-[11px] text-muted hover:text-bright">Copy</button>
                </div>
                <textarea value={polished} readOnly rows={8}
                  className="w-full px-2 py-1.5 text-[11px] font-mono leading-snug bg-panel border border-edge rounded outline-none resize-y selection:bg-blue-500/40 text-fg" />
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Right-click context menu */}
      {menu && (
        <div className="fixed z-[60] w-48 bg-panel border border-edge rounded shadow-xl py-1 text-xs"
          style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
          {menu.kind === "edge" ? (
            <button className="w-full text-left px-3 py-1.5 text-red-300 hover:bg-elevated"
              onClick={() => { deleteElements({ edges: [{ id: menu.id }] }); setMenu(null); }}>
              Disconnect
            </button>
          ) : menu.type === "start" ? (
            <div className="px-3 py-1.5 text-dim">Start — entry point</div>
          ) : (
            <>
              <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-dim">Change to</div>
              <KindList kinds={ADDABLE_KINDS.filter(k => k !== menu.type)} onPick={k => convert(menu.id, k)} />
              <div className="my-1 border-t border-edge" />
              <button className="w-full text-left px-3 py-1.5 text-red-300 hover:bg-elevated"
                onClick={() => { deleteElements({ nodes: [{ id: menu.id }] }); setMenu(null); }}>
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Drag-off-to-empty picker: choose what the next connected box is. The backdrop catches a
          click-away to cancel — it's a separate overlay, so the synthetic `click` the drag-release
          fires on the canvas (which would otherwise cancel us a frame after we open) can't reach it. */}
      {drop && (
        <div className="fixed inset-0 z-[55]" onPointerDown={cancelPending}
          onContextMenu={e => { e.preventDefault(); cancelPending(); }} />
      )}
      {drop && (
        <div className="fixed z-[60] w-52 bg-panel border border-edge rounded shadow-xl py-1"
          style={{ left: drop.x, top: drop.y }} onClick={e => e.stopPropagation()}>
          <div className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-dim">Add &amp; connect</div>
          <KindList kinds={ADDABLE_KINDS.filter(k => k !== "param")} onPick={choosePending} />
        </div>
      )}

      {/* Resume prompt — a draft survived a refresh / crash / accidental close. Pick up, or start fresh. */}
      {restore && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="w-[420px] max-w-full bg-canvas border border-edge rounded-lg shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-bright mb-1">Unsaved blueprint found</div>
            <p className="text-xs text-dim leading-snug mb-4">
              You have an unsaved blueprint{restore.name.trim() ? ` — “${restore.name.trim()}”` : ""} from last time.
              Pick up where you left off, or start fresh?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={startFresh} className={btn}>Start new</button>
              <button onClick={resumeDraft} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white">Resume</button>
            </div>
          </div>
        </div>
      )}

      {/* Close guard — unsaved changes on ✕. Save (to the DB), discard, or cancel and keep editing. */}
      {closeConfirm && (
        <div className="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4">
          <div className="w-[420px] max-w-full bg-canvas border border-edge rounded-lg shadow-xl p-5" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-bright mb-1">Save changes before closing?</div>
            <p className="text-xs text-dim leading-snug mb-4">This blueprint has unsaved changes.</p>
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => setCloseConfirm(false)} className={btn}>Cancel</button>
              <div className="flex items-center gap-2">
                <button onClick={confirmDiscard} className={`${btn} text-red-300 hover:!bg-red-600/30 hover:!border-red-500/50`}>Discard</button>
                <button onClick={confirmSave} disabled={save.isPending}
                  className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">{save.isPending ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && <AiProviderSettings onClose={() => { setSettingsOpen(false); qc.invalidateQueries({ queryKey: ["ai"] }); }} />}
    </div>
  );
}

// Line icons for the canvas tool buttons. Inline `fill: none` + `stroke: currentColor` so they
// render correctly regardless of React Flow's control-button CSS, and inherit the button's colour.
const ICON = { width: 14, height: 14, viewBox: "0 0 24 24", style: { fill: "none", stroke: "currentColor" } as const, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
/** Arrow = Pointer tool (normal cursor). */
function IconPointer() {
  return (
    <svg {...ICON}>
      <path d="M5 3v16l4-4 2.5 5 2-1-2.4-4.8H17z" />
    </svg>
  );
}
/** Hand = Move/Pan tool. */
function IconHand() {
  return (
    <svg {...ICON}>
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}
/** Dashed box = Select (box-select) tool. */
function IconMarquee() {
  return (
    <svg {...ICON}>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3" />
    </svg>
  );
}

/** A small colored swatch for a node kind, used across the Add / Change-type / drop-picker menus. */
function KindDot({ kind }: { kind: BlueprintNodeKind }) {
  return <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: KIND_META[kind].mini }} />;
}

/** Shared kind list: a row per kind with swatch + friendly name + faded technical term. */
function KindList({ kinds, onPick }: { kinds: BlueprintNodeKind[]; onPick: (k: BlueprintNodeKind) => void }) {
  return (
    <>
      {kinds.map(k => (
        <button key={k} onClick={() => onPick(k)}
          className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-elevated">
          <KindDot kind={k} />
          <span className="text-fg">{KIND_META[k].name}</span>
          <span className="ml-auto text-[10px] text-dim">{KIND_META[k].tech}</span>
        </button>
      ))}
    </>
  );
}
