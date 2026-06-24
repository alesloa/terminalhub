import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../../api/client";
import type { AiChatMessage, BlueprintGraph, BlueprintOp } from "../../../api/types";
import { useToasts } from "../../../store/toasts";
import { KIND_META } from "./nodes";

/**
 * Floating AI assistant pinned over the blueprint canvas. It lives OUTSIDE React Flow's transformed
 * viewport (a plain absolute sibling of <ReactFlow>), so it stays in screen space — panning or
 * zooming the canvas never moves or scales it. The header is a drag handle to reposition it; it
 * defaults to the bottom-right so it doesn't cover the graph.
 *
 * The transcript (`messages`) is owned by BlueprintCanvas so it saves/loads with the blueprint;
 * this component just reads and mutates it. The engine follows the codex-first priority (codex CLI
 * when installed, else a configured API provider), with a dropdown to override. `spec`/`targetTool`/
 * `graph`/`selected` are sent with each turn so the model stays grounded in the live blueprint and
 * can target cards by id. When the model returns canvas ops, `onOps` applies them to the canvas.
 */
export function BlueprintChat({ spec, targetTool, graph, selected, messages, setMessages, onOps, onDeselect, onOpenSettings }:
  { spec: string; targetTool: string; graph: BlueprintGraph; selected: string[];
    messages: AiChatMessage[]; setMessages: Dispatch<SetStateAction<AiChatMessage[]>>;
    onOps: (ops: BlueprintOp[]) => void; onDeselect: (id: string) => void; onOpenSettings: () => void }) {
  const push = useToasts(s => s.push);
  const { data: builder } = useQuery({ queryKey: ["ai", "builder"], queryFn: () => api.ai.builder() });
  const engines = builder?.engines ?? [];
  const noEngine = !!builder && engines.length === 0;

  const [engineId, setEngineId] = useState<string | null>(null);
  useEffect(() => {
    if (!builder) return;
    setEngineId(prev => (prev && engines.some(e => e.id === prev) ? prev : builder.defaultChatEngineId));
  }, [builder]); // eslint-disable-line react-hooks/exhaustive-deps

  const [input, setInput] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null); // which bubble is in edit mode
  const [editText, setEditText] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false); // the "?" tips panel (how to talk to the assistant)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null); // null = default bottom-right
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the transcript pinned to the latest message as it grows / while a reply streams in.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, collapsed]);

  // Everything the request needs is passed as the mutate *variable*, computed below in the fresh
  // event handler. The mutationFn must NOT close over messages/spec/graph/engineId — react-query can
  // invoke a stale closure, which would send only the current turn with empty history (no memory).
  const send = useMutation({
    mutationFn: (v: { messages: AiChatMessage[]; spec: string; targetTool: string; engineId?: string; graph: BlueprintGraph; selected: string[] }) =>
      api.ai.chat(v.messages, { spec: v.spec, targetTool: v.targetTool, engineId: v.engineId, graph: v.graph, selected: v.selected }),
    onSuccess: ({ reply, ops }) => {
      setMessages(m => [...m, { role: "assistant", content: reply }]);
      if (ops.length) onOps(ops); // the AI built/edited the canvas — apply it
    },
    onError: (e: Error) => push(e.message), // the user turn stays so they can retry/edit
  });

  const submit = () => {
    const text = input.trim();
    if (!text || send.isPending) return;
    const next: AiChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    send.mutate({ messages: next, spec, targetTool, engineId: engineId ?? undefined, graph, selected });
  };

  // Per-message editing: hover a bubble for a pencil (edit in place) or trash (delete it). Works on
  // both your turns and the AI's. Edits change the stored transcript, so the next send uses them.
  const deleteAt = (i: number) => { setMessages(m => m.filter((_, idx) => idx !== i)); setEditingIndex(null); };
  const startEdit = (i: number) => { setEditingIndex(i); setEditText(messages[i].content); };
  const cancelEdit = () => setEditingIndex(null);
  const saveEdit = () => {
    if (editingIndex == null) return;
    const text = editText.trim();
    if (text) setMessages(m => m.map((msg, k) => (k === editingIndex ? { ...msg, content: text } : msg)));
    else setMessages(m => m.filter((_, k) => k !== editingIndex)); // emptied → treat as delete
    setEditingIndex(null);
  };

  // Drag the panel by its header. Listens on window (no pointer capture) so the drag survives the
  // cursor leaving the small header; clamps the box inside its positioned parent (the canvas pane).
  const onDragStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;
    e.preventDefault();
    const parent = (panel.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left, offY = e.clientY - rect.top;
    const base = parent ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const move = (ev: PointerEvent) => {
      const maxX = Math.max(0, base.width - rect.width), maxY = Math.max(0, base.height - rect.height);
      setPos({
        x: Math.min(Math.max(0, ev.clientX - base.left - offX), maxX),
        y: Math.min(Math.max(0, ev.clientY - base.top - offY), maxY),
      });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const posStyle = pos ? { left: pos.x, top: pos.y } : { right: 16, bottom: 16 };

  // The card(s) currently selected on the canvas, shown as removable chips above the composer so it's
  // obvious what "this"/"here" points at — and so a stray selection can be dropped with one ×. Order
  // follows the canvas; an unnamed card reads "untitled".
  const selectedSet = new Set(selected);
  const selectedCards = graph.nodes
    .filter(n => selectedSet.has(n.id))
    .map(n => ({ id: n.id, name: KIND_META[n.type].name, accent: KIND_META[n.type].accent, label: n.data?.label?.trim() ?? "" }));

  return (
    <div ref={panelRef}
      className={`absolute z-30 w-[380px] flex flex-col bg-panel/95 backdrop-blur border border-edge-strong rounded-lg shadow-2xl overflow-hidden ${collapsed ? "" : "h-[460px] max-h-[calc(100%-24px)]"}`}
      style={posStyle} onClick={e => e.stopPropagation()}>
      {/* Header / drag handle */}
      <div onPointerDown={onDragStart}
        className="flex items-center gap-2 px-3 h-9 shrink-0 border-b border-edge bg-elevated/60 cursor-move select-none">
        <span className="text-blue-400">✦</span>
        <span className="text-xs font-semibold text-bright">AI assistant</span>
        <div className="ml-auto flex items-center gap-1.5" onPointerDown={e => e.stopPropagation()}>
          {engines.length > 0 && (
            <select value={engineId ?? ""} onChange={e => setEngineId(e.target.value || null)}
              title="Which AI answers (codex by default)"
              className="max-w-[110px] px-1.5 py-0.5 text-[11px] bg-panel border border-edge rounded outline-none focus:border-blue-500 text-fg">
              {engines.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          )}
          <button onClick={() => { setCollapsed(false); setHelpOpen(o => !o); }} title="Tips — how to get the most out of the assistant"
            className={`text-xs px-0.5 ${helpOpen ? "text-blue-400" : "text-dim hover:text-fg"}`}>?</button>
          <button onClick={onOpenSettings} title="AI providers & API keys" className="text-dim hover:text-fg text-xs px-0.5">⚙</button>
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} title="Clear chat" className="text-dim hover:text-fg text-xs px-0.5">⌫</button>
          )}
          <button onClick={() => setCollapsed(c => !c)} title={collapsed ? "Expand" : "Collapse"}
            className="text-dim hover:text-fg text-xs px-0.5">{collapsed ? "▢" : "—"}</button>
        </div>
      </div>

      {!collapsed && helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

      {!collapsed && !helpOpen && (
        <>
          {/* Transcript */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-2">
            {noEngine ? (
              <div className="text-[11px] text-amber-300/90 leading-snug">
                No AI engine yet. Install <code>codex</code> (used automatically), or add an API key
                (DeepSeek, Kimi, Anthropic, OpenAI) in{" "}
                <button onClick={onOpenSettings} className="underline hover:text-amber-200">settings ⚙</button>.
              </div>
            ) : messages.length === 0 ? (
              <div className="text-[11px] text-dim leading-snug">
                Tell me what to build and I'll draw it on the canvas — e.g. “add a retry loop after
                fetch, and an error step if it fails.” I can see your cards and edit them: select one
                and say “rename this” or “add a check after it.” I can also suggest steps and edge
                cases, or polish it into a prompt.
              </div>
            ) : (
              messages.map((m, i) => editingIndex === i ? (
                <EditRow key={i} role={m.role} value={editText} onChange={setEditText} onSave={saveEdit} onCancel={cancelEdit} />
              ) : (
                <Bubble key={i} role={m.role} content={m.content} onEdit={() => startEdit(i)} onDelete={() => deleteAt(i)} />
              ))
            )}
            {send.isPending && <div className="text-[11px] text-dim italic">Thinking…</div>}
          </div>

          {/* Composer */}
          <div className="shrink-0 border-t border-edge p-2">
            {/* Selected-card chips: what the assistant will treat as "this". × deselects on the canvas. */}
            {selectedCards.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {selectedCards.map(c => (
                  <span key={c.id}
                    className="inline-flex items-center gap-1 max-w-full pl-1.5 pr-1 py-0.5 rounded bg-blue-600/15 border border-blue-500/40 text-[11px]">
                    <span className={`shrink-0 font-medium ${c.accent}`}>{c.name}</span>
                    <span className="truncate text-fg">{c.label || "untitled"}</span>
                    <button onClick={() => onDeselect(c.id)} title="Deselect this card"
                      className="shrink-0 text-dim hover:text-fg leading-none px-0.5">×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                placeholder={noEngine ? "Set up an AI engine first…" : "Ask anything — Enter to send, Shift+Enter for a new line"}
                disabled={noEngine}
                className="flex-1 min-w-0 resize-none px-2 py-1.5 text-[12px] leading-snug bg-panel border border-edge rounded outline-none focus:border-blue-500 text-fg placeholder:text-dim disabled:opacity-50" />
              <button onClick={submit} disabled={noEngine || send.isPending || !input.trim()}
                className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 shrink-0">
                {send.isPending ? "…" : "Send"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Bubble({ role, content, onEdit, onDelete }:
  { role: "user" | "assistant"; content: string; onEdit: () => void; onDelete: () => void }) {
  const mine = role === "user";
  return (
    <div className={`group flex items-center gap-1 ${mine ? "justify-end" : "justify-start"}`}>
      {mine && <MsgControls onEdit={onEdit} onDelete={onDelete} />}
      <div className={`max-w-[85%] px-2.5 py-1.5 rounded-lg text-[12px] leading-snug whitespace-pre-wrap break-words selection:bg-blue-500/40 ${
        mine ? "bg-blue-600/30 border border-blue-500/40 text-fg" : "bg-elevated border border-edge text-fg"}`}>
        {content}
      </div>
      {!mine && <MsgControls onEdit={onEdit} onDelete={onDelete} />}
    </div>
  );
}

/** Hover-revealed edit/delete buttons sitting beside a message bubble. */
function MsgControls({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={onEdit} title="Edit message" className="p-1 text-dim hover:text-fg"><IconPencil /></button>
      <button onClick={onDelete} title="Delete message" className="p-1 text-dim hover:text-red-300"><IconTrash /></button>
    </div>
  );
}

/** Inline editor shown in place of a bubble while editing it. ⌘/Ctrl+Enter saves, Esc cancels. */
function EditRow({ role, value, onChange, onSave, onCancel }:
  { role: "user" | "assistant"; value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void }) {
  const mine = role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="w-[85%]">
        <textarea autoFocus value={value} onChange={e => onChange(e.target.value)} rows={3}
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
            else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          }}
          className="w-full resize-none px-2 py-1.5 text-[12px] leading-snug bg-panel border border-blue-500/60 rounded outline-none text-fg" />
        <div className="flex justify-end gap-1.5 mt-1">
          <button onClick={onCancel} className="text-[11px] text-dim hover:text-fg px-1.5 py-0.5">Cancel</button>
          <button onClick={onSave} className="text-[11px] px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white">Save</button>
        </div>
      </div>
    </div>
  );
}

/**
 * In-panel "Tips" view (the ? button). Best practices for driving the canvas with the assistant —
 * kept in the UI on purpose, since these are easy to forget and there's nowhere else to surface them.
 * The "build it on the canvas" nudge is here for when a model replies in prose instead of editing.
 */
function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-2.5">
        <p className="text-[11px] text-muted leading-snug">Getting the most out of the assistant:</p>
        <Tip title="Tell it to build, not just chat">
          “Add a retry loop after Fetch, and an error step if it fails.” It draws the boxes and wires them.
        </Tip>
        <Tip title="Point at a card">
          Click a card to select it, then “rename this” or “add a check after this” — it edits that exact one.
        </Tip>
        <Tip title="If it replies in words but doesn't build it">
          Some models need a nudge — say “go ahead and build that on the canvas.”
        </Tip>
        <Tip title="It can restructure too">
          “Remove the dead branch,” “clean this up,” “split that step into two.”
        </Tip>
        <Tip title="Undo anytime">
          The <span className="text-blue-300">↩ Undo AI</span> button in the top toolbar reverts its last change in one click.
        </Tip>
        <Tip title="Describe your branches">
          For a yes/no or a pick-a-path, say what each branch should do.
        </Tip>
        <Tip title="Switch engines">
          Use the dropdown above (codex is the default whenever it's installed).
        </Tip>
      </div>
      <div className="shrink-0 border-t border-edge p-2 flex justify-end">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white">Got it</button>
      </div>
    </div>
  );
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="text-[11px] leading-snug">
      <div className="text-bright font-medium">{title}</div>
      <div className="text-muted">{children}</div>
    </div>
  );
}

const MICRO = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
function IconPencil() {
  return <svg {...MICRO}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
}
function IconTrash() {
  return <svg {...MICRO}><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>;
}
