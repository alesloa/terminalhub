import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { CopilotMessage, CopilotFrame, CopilotConversation } from "../../api/types";
import { useCopilotConversations, useDeleteConversation } from "../../hooks/useCopilot";
import { confirmModal } from "../../store/confirm";
import { useCopilotSocket } from "./useCopilotSocket";

// One rendered chat turn. `tools` are the action chips shown under an assistant turn (live: with a
// running spinner + summary; persisted: name + parsed summary). A `callId` ties a live chip to its
// later tool_result frame.
interface ChipT { callId?: string; name: string; ok: boolean; summary: string; running?: boolean }
interface UiMsg { id: string; role: "user" | "assistant"; text: string; tools: ChipT[] }

const SUGGESTIONS = ["What can you do?", "Add a note", "Check my email", "Set a reminder for 3pm", "Add \"ship copilot\" to my board"];

// Flatten the persisted block transcript into rendered turns: join text blocks, surface tool_use as
// chips (enriched with the matching tool_result's summary), and drop the internal tool_result-only
// user messages so they don't show as empty bubbles.
function toUiMessages(msgs: CopilotMessage[]): UiMsg[] {
  const results = new Map<string, { ok: boolean; summary: string }>();
  for (const m of msgs) for (const b of m.content) if (b.type === "tool_result") { try { const r = JSON.parse(b.content); results.set(b.tool_use_id, { ok: !!r.ok, summary: r.summary ?? "" }); } catch { /* opaque */ } }
  const out: UiMsg[] = [];
  for (const m of msgs) {
    if (m.content.length > 0 && m.content.every((b) => b.type === "tool_result")) continue;
    const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const tools: ChipT[] = m.content.filter((b) => b.type === "tool_use").map((b) => {
      const tu = b as { id: string; name: string };
      const r = results.get(tu.id);
      return { name: tu.name, ok: r?.ok ?? true, summary: r?.summary ?? "" };
    });
    if (!text && tools.length === 0) continue;
    out.push({ id: m.id, role: m.role, text, tools });
  }
  return out;
}

// A saved chat's display label: its title (set from the first message), or a fallback.
const titleOf = (c?: CopilotConversation) => c?.title?.trim() || "Untitled chat";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function CopilotChat() {
  const qc = useQueryClient();
  const convos = useCopilotConversations();
  const del = useDeleteConversation();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ callId: string; name: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const draftIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resumedRef = useRef(false);

  const list = convos.data ?? [];
  const currentTitle = conversationId ? titleOf(list.find((c) => c.id === conversationId)) : "New chat";

  // Load a saved conversation's transcript and make it the active chat.
  const openConversation = async (id: string) => {
    setHistoryOpen(false);
    setError(null);
    setConversationId(id);
    draftIdRef.current = null;
    try {
      const { messages: m } = await api.copilot.getConversation(id);
      setMessages(toUiMessages(m));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load that chat.");
    }
  };

  // Start a fresh chat. The current one stays saved in history; the server row is created lazily on
  // the first send (so empty chats never pile up).
  const newChat = () => {
    setHistoryOpen(false);
    setError(null);
    setConversationId(null);
    setMessages([]);
    draftIdRef.current = null;
  };

  // Delete a saved conversation (and its messages). If it was the active one, drop back to a new chat.
  const removeConversation = async (id: string) => {
    const ok = await confirmModal({ title: "Delete chat", body: "Delete this conversation and its messages? This can't be undone.", confirmLabel: "Delete" });
    if (!ok) return;
    try { await del.mutateAsync(id); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't delete that chat."); return; }
    if (id === conversationId) newChat();
  };

  // Clear the current chat: delete it outright if it's been saved, otherwise just empty the view.
  const clearCurrent = async () => {
    if (conversationId) { await removeConversation(conversationId); return; }
    setMessages([]);
    setError(null);
  };

  // On first load, resume the most recent conversation (or start fresh). Conversations persist server-side.
  useEffect(() => {
    if (resumedRef.current || !convos.data) return;
    resumedRef.current = true;
    if (convos.data.length) void openConversation(convos.data[0].id);
  }, [convos.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, fn: (m: UiMsg) => UiMsg) => setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const onFrame = (f: CopilotFrame) => {
    const draftId = draftIdRef.current;
    switch (f.type) {
      case "token":
        if (draftId) patch(draftId, (m) => ({ ...m, text: m.text + f.delta }));
        break;
      case "tool_call":
        if (draftId) patch(draftId, (m) => ({ ...m, tools: [...m.tools, { callId: f.callId, name: f.name, ok: true, summary: "", running: true }] }));
        break;
      case "tool_result":
        if (draftId) patch(draftId, (m) => ({ ...m, tools: m.tools.map((t) => (t.callId === f.callId ? { ...t, ok: f.ok, summary: f.summary, running: false } : t)) }));
        break;
      case "confirm_request":
        setPendingConfirm({ callId: f.callId, name: f.name });
        if (draftId) patch(draftId, (m) => ({ ...m, tools: [...m.tools, { callId: f.callId, name: f.name, ok: true, summary: "awaiting your confirmation…", running: true }] }));
        break;
      case "final":
        if (draftId && f.text) patch(draftId, (m) => ({ ...m, text: f.text }));
        break;
      case "error":
        setError(f.message);
        break;
      case "done":
        setBusy(false);
        // Drop an empty draft (assistant returned nothing) so it doesn't leave a stuck typing wave.
        if (draftId) setMessages((ms) => ms.filter((m) => !(m.id === draftId && !m.text && m.tools.length === 0)));
        draftIdRef.current = null;
        setPendingConfirm(null);
        qc.invalidateQueries({ queryKey: ["copilot", "conversations"] });
        break;
    }
  };

  const socket = useCopilotSocket(onFrame);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  const submit = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    let id = conversationId;
    if (!id) {
      // Auto-title the new conversation from its first message so history is browsable.
      try { id = (await api.copilot.createConversation(text.slice(0, 60))).conversation.id; setConversationId(id); qc.invalidateQueries({ queryKey: ["copilot", "conversations"] }); }
      catch (e) { setError(e instanceof Error ? e.message : "Couldn't start a conversation."); return; }
    }
    const userId = `u_${Date.now()}`;
    const draftId = `a_${Date.now()}`;
    draftIdRef.current = draftId;
    setMessages((ms) => [...ms, { id: userId, role: "user", text, tools: [] }, { id: draftId, role: "assistant", text: "", tools: [] }]);
    setBusy(true);
    socket.send(id, text);
  };

  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b border-edge">
        <div className="relative flex-1 min-w-0">
          <button onClick={() => setHistoryOpen((o) => !o)} disabled={busy} title="Chat history"
            className="flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg hover:bg-elevated text-muted hover:text-bright disabled:opacity-40 disabled:hover:bg-transparent transition-colors">
            <HistoryIcon />
            <span className="truncate text-xs font-medium">{currentTitle}</span>
            <ChevronIcon />
          </button>
          {historyOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setHistoryOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-72 max-h-80 overflow-auto rounded-xl border border-edge-strong bg-elevated py-1 shadow-2xl">
                {list.length === 0 && <div className="px-3 py-2 text-xs text-dim">No saved chats yet.</div>}
                {list.map((c) => (
                  <div key={c.id} className={`group flex items-center gap-1 px-1.5 ${c.id === conversationId ? "bg-surface" : "hover:bg-surface/60"}`}>
                    <button onClick={() => openConversation(c.id)} className="flex-1 min-w-0 text-left py-1.5 px-1">
                      <div className="truncate text-xs text-bright">{titleOf(c)}</div>
                      <div className="text-[10px] text-dim">{timeAgo(c.updatedAt)}</div>
                    </button>
                    <button onClick={() => removeConversation(c.id)} title="Delete chat"
                      className="shrink-0 w-6 h-6 rounded-md text-dim hover:text-red-300 hover:bg-red-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <TrashIcon />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <button onClick={newChat} disabled={busy} title="New chat"
          className="shrink-0 w-7 h-7 rounded-lg hover:bg-elevated text-muted hover:text-bright disabled:opacity-40 flex items-center justify-center transition-colors">
          <PlusIcon />
        </button>
        <button onClick={clearCurrent} disabled={busy || (messages.length === 0 && !conversationId)} title="Clear chat"
          className="shrink-0 w-7 h-7 rounded-lg hover:bg-elevated text-muted hover:text-red-300 disabled:opacity-40 disabled:hover:text-muted flex items-center justify-center transition-colors">
          <TrashIcon />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 text-muted">
            <div className="w-12 h-12 rounded-full bg-blue-600/15 flex items-center justify-center text-blue-400"><SparkIcon /></div>
            <div>
              <div className="text-bright font-semibold">Hi — I'm your Assistant.</div>
              <div className="text-sm mt-1">I know Terminal Hub inside out, and I can act for you — notes, board, reminders, email, and more.</div>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} className="px-3 py-1.5 text-xs rounded-full border border-edge bg-panel hover:bg-elevated hover:text-bright transition-colors">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => <MessageRow key={m.id} m={m} />)}
        {error && <div className="mx-auto max-w-md text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      </div>

      {pendingConfirm && (
        <div className="px-4 py-3 border-t border-edge bg-amber-500/10 flex items-center justify-between gap-3">
          <span className="text-sm text-amber-200">Run <code className="font-mono">{pendingConfirm.name}</code>? This can change things.</span>
          <div className="flex gap-2">
            <button onClick={() => { socket.confirm(pendingConfirm.callId, false); setPendingConfirm(null); }} className="px-3 py-1 text-sm rounded bg-elevated hover:bg-edge">Deny</button>
            <button onClick={() => { socket.confirm(pendingConfirm.callId, true); setPendingConfirm(null); }} className="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white">Approve</button>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-edge p-3">
        <div className="flex items-end gap-2 bg-panel border border-edge rounded-xl px-3 py-2 focus-within:border-blue-500/60 transition-colors">
          <textarea
            value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1}
            placeholder={busy ? "Working…" : "Ask me anything, or tell me to do something…"}
            className="flex-1 bg-transparent resize-none outline-none text-sm leading-6 max-h-32 py-1 placeholder:text-dim"
            disabled={busy}
          />
          <button onClick={() => submit()} disabled={busy || !input.trim()} title="Send"
            className="shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white flex items-center justify-center transition-colors">
            {busy ? <Spinner /> : <SendIcon />}
          </button>
        </div>
        {!socket.connected && <div className="text-[11px] text-dim mt-1 px-1">connecting…</div>}
      </div>
    </div>
  );
}

function MessageRow({ m }: { m: UiMsg }) {
  const isUser = m.role === "user";
  // An empty assistant bubble with no tool chips is the live draft still composing its reply.
  const thinking = !isUser && !m.text && m.tools.length === 0;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1.5`}>
        {(m.text || isUser || thinking) && (
          <div className={`px-3.5 py-2 rounded-2xl text-sm leading-6 whitespace-pre-wrap break-words ${isUser ? "bg-blue-600 text-white rounded-br-md" : "bg-panel border border-edge rounded-bl-md"}`}>
            {thinking ? <TypingDots /> : m.text}
          </div>
        )}
        {m.tools.map((t, i) => <ToolChip key={t.callId ?? i} t={t} />)}
      </div>
    </div>
  );
}

// The "assistant is typing" wave: three dots cresting left→right (CSS keyframe tr-wave in theme.css).
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1 text-muted" aria-label="Assistant is typing">
      {[0, 150, 300].map((d) => (
        <span key={d} className="tr-wave-dot w-1.5 h-1.5 rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function ToolChip({ t }: { t: ChipT }) {
  const icon = t.running ? <Spinner /> : t.ok ? <span className="text-green-400">✓</span> : <span className="text-amber-400">⚠</span>;
  return (
    <div className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-elevated/60 border border-edge text-muted">
      {icon}
      <span className="font-mono text-bright">{t.name}</span>
      {t.summary && <span className="truncate max-w-[18rem]">— {t.summary}</span>}
    </div>
  );
}

const SendIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>);
const SparkIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" /></svg>);
const Spinner = () => (<svg width="14" height="14" viewBox="0 0 24 24" className="animate-spin"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>);
const HistoryIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 2" /></svg>);
const ChevronIcon = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70"><path d="m6 9 6 6 6-6" /></svg>);
const PlusIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>);
const TrashIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" /><path d="M10 11v6M14 11v6" /></svg>);
