import { useCallback, useEffect, useRef, useState } from "react";
import { api, guiSocketUrl } from "../../api/client";
import type {
  GuiApprovalDecision,
  GuiApprovalRequest,
  GuiClientFrame,
  GuiConfig,
  GuiContextUsage,
  GuiEvent,
  GuiImageAttachment,
  GuiMessage,
  GuiQuestionRequest,
  GuiRewindPreview,
  GuiServerFrame,
  GuiSessionState,
} from "../../api/guiTypes";

const PING_EVERY_MS = 25_000; // matches useTerminalSocket — under typical ~100s proxy idle timeouts
const MAX_BACKOFF_MS = 5_000;
const DELTA_FLUSH_MS = 50;    // ~20 commits/sec while streaming: smooth to read, cheap to render

function findMessage(work: GuiMessage[], id: string): number {
  for (let i = work.length - 1; i >= 0; i--) if (work[i].id === id) return i;
  return -1;
}

/**
 * Fold one transcript-shaped event into the working array.
 *
 * The array is mutated in place — it is private to the hook and never handed to React directly — but
 * every message and block object it touches is REPLACED. That keeps the identity of untouched
 * messages stable, which is what lets the memoized MessageRow skip re-rendering while a later
 * message streams. Returns false for events that aren't transcript-shaped.
 */
function applyEvent(work: GuiMessage[], ev: GuiEvent): boolean {
  switch (ev.type) {
    case "message.start": {
      if (findMessage(work, ev.id) !== -1) return false; // resend/replay — don't duplicate the turn
      work.push({ id: ev.id, role: ev.role, blocks: [], ts: ev.ts });
      return true;
    }
    case "block.start": {
      const mi = findMessage(work, ev.messageId);
      if (mi === -1) return false;
      const msg = work[mi];
      if (msg.blocks.some((b) => b.id === ev.block.id)) return false;
      work[mi] = { ...msg, blocks: [...msg.blocks, ev.block] };
      return true;
    }
    case "block.delta": {
      const mi = findMessage(work, ev.messageId);
      if (mi === -1) return false;
      const msg = work[mi];
      const bi = msg.blocks.findIndex((b) => b.id === ev.blockId);
      if (bi === -1) return false;
      const block = msg.blocks[bi];
      if (block.kind !== "text" && block.kind !== "thinking") return false;
      const blocks = msg.blocks.slice();
      blocks[bi] = { ...block, text: block.text + ev.text };
      work[mi] = { ...msg, blocks };
      return true;
    }
    case "block.input": {
      const mi = findMessage(work, ev.messageId);
      if (mi === -1) return false;
      const msg = work[mi];
      const bi = msg.blocks.findIndex((b) => b.id === ev.blockId);
      if (bi === -1) return false;
      const block = msg.blocks[bi];
      if (block.kind !== "tool") return false;
      const blocks = msg.blocks.slice();
      blocks[bi] = { ...block, input: ev.input };
      work[mi] = { ...msg, blocks };
      return true;
    }
    case "tool.result": {
      // toolUseId doesn't carry a message id, so scan back from the newest turn — the match is
      // almost always in the last message.
      for (let mi = work.length - 1; mi >= 0; mi--) {
        const msg = work[mi];
        for (let bi = msg.blocks.length - 1; bi >= 0; bi--) {
          const block = msg.blocks[bi];
          if (block.kind !== "tool" || block.toolUseId !== ev.toolUseId) continue;
          const blocks = msg.blocks.slice();
          blocks[bi] = { ...block, status: ev.status, result: ev.result };
          work[mi] = { ...msg, blocks };
          return true;
        }
      }
      return false;
    }
    default:
      return false; // message.end / block.end carry no state this layer keeps
  }
}

/** How a rewind ended. `ok:false` means the conversation was left exactly as it was. */
export interface GuiRewindResult { ok: boolean; error?: string }

export interface GuiSocket {
  messages: GuiMessage[];
  busy: boolean;
  state: GuiSessionState;
  connected: boolean;
  sessionId: string | null;
  error: string | null;
  pendingApproval: GuiApprovalRequest | null;
  pendingQuestion: GuiQuestionRequest | null;
  /** The most recent plan Claude proposed, until it is answered or the chat is rewound. */
  plan: string | null;
  dismissPlan: () => void;
  /** Context-window occupancy as the CLI measures it, null until the first reading arrives. */
  contextUsage: GuiContextUsage | null;
  /** Cumulative estimated cost of this session, as reported at the end of each turn. */
  costUsd: number | null;
  /** A transient, non-failure message (e.g. "reverted 3 files"). */
  notice: string | null;
  /** null until the socket's `history` frame lands — the composer has no default of its own to fall
   *  back to, so its pills stay hidden rather than showing a value the server hasn't confirmed. */
  config: GuiConfig | null;
  send: (text: string, images?: GuiImageAttachment[]) => void;
  interrupt: () => void;
  approve: (id: string, decision: GuiApprovalDecision) => void;
  answer: (id: string, answers: Record<string, string[]>) => void;
  /** Cut the chat back to a user turn — `newText` re-sends it reworded, omitting it deletes it and
   *  everything after. `userTurnsAfter` is how many user turns come after the target (0 = latest).
   *  Resolves with the server's ruling, so an editor can keep the user's text until the edit lands. */
  rewind: (userTurnsAfter: number, text: string, newText?: string, restoreFiles?: boolean) => Promise<GuiRewindResult>;
  /** Ask what "undo file changes" would cost at that turn. Answers land in `rewindPreview`. */
  previewRewind: (userTurnsAfter: number, text: string) => void;
  /** The most recent answer to `previewRewind`, tagged with the turn that asked. */
  rewindPreview: GuiRewindPreview | null;
  setConfig: (patch: Partial<GuiConfig>) => void;
}

/**
 * Owns the /ws/gui socket for one terminal and reduces its event stream into a renderable transcript.
 * Reconnects with backoff like the terminal socket; a reconnect re-seeds from the server's `history`
 * frame, so the transcript is always the server's, never a locally patched guess.
 */
export function useGuiSocket(terminalId: string): GuiSocket {
  const [messages, setMessages] = useState<GuiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<GuiSessionState>("idle");
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<GuiApprovalRequest | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<GuiQuestionRequest | null>(null);
  const [config, setConfigState] = useState<GuiConfig | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [contextUsage, setContextUsage] = useState<GuiContextUsage | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rewindPreview, setRewindPreview] = useState<GuiRewindPreview | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // The caller waiting on the current rewind, if any. Settled by the server's ack, or by the socket
  // dying — never left hanging, because whoever is waiting is holding text the user typed.
  const rewindWaiterRef = useRef<((result: GuiRewindResult) => void) | null>(null);
  const workRef = useRef<GuiMessage[]>([]);
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The live config, readable without re-creating setConfig on every change (it's the rollback value
  // for a failed PATCH). `epoch` bumps whenever the socket is re-established for a different
  // terminal, so an in-flight PATCH can't write its answer into the next terminal's pills.
  const configRef = useRef<GuiConfig | null>(null);
  const epochRef = useRef(0);

  const applyConfig = useCallback((next: GuiConfig | null) => {
    configRef.current = next;
    setConfigState(next);
  }, []);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    epochRef.current++;
    workRef.current = [];
    setMessages([]);
    setBusy(false);
    setState("idle");
    setSessionId(null);
    setError(null);
    setPendingApproval(null);
    setPendingQuestion(null);
    applyConfig(null);

    // Hand React a fresh array; the working copy stays mutable and private.
    const commit = () => {
      if (flushRef.current) { clearTimeout(flushRef.current); flushRef.current = null; }
      setMessages(workRef.current.slice());
    };
    // Deltas arrive per token, so they coalesce into at most one commit per window instead of one
    // render (and one markdown re-parse) per character. A timer rather than rAF so a backgrounded
    // tab still flushes the tail of a response.
    const scheduleCommit = () => {
      if (flushRef.current) return;
      flushRef.current = setTimeout(() => { flushRef.current = null; setMessages(workRef.current.slice()); }, DELTA_FLUSH_MS);
    };

    const onEvent = (ev: GuiEvent) => {
      switch (ev.type) {
        case "turn.start": setBusy(true); setError(null); break;
        case "turn.end":
          setBusy(false);
          // The SDK reports a running total per query, so the latest value IS the session cost.
          if (typeof ev.costUsd === "number") setCostUsd(ev.costUsd);
          commit(); // flush the tail of the last delta window
          break;
        case "state": setState(ev.state); break;
        case "session": setSessionId(ev.sessionId); break;
        case "history.reset":
          // A rewind can drop any amount of the conversation, so this replaces rather than patches.
          workRef.current = ev.messages.slice();
          setPendingApproval(null);
          setPendingQuestion(null);
          setError(null);
          setPlan(null);
          setRewindPreview(null);
          commit();
          break;
        case "config": applyConfig(ev.config); break;
        case "approval.request": setPendingApproval(ev.request); break;
        case "approval.resolved": setPendingApproval((p) => (p && p.id === ev.id ? null : p)); break;
        case "question.request": setPendingQuestion(ev.request); break;
        case "question.resolved": setPendingQuestion((p) => (p && p.id === ev.id ? null : p)); break;
        case "error": setError(ev.message); break;
        case "notice": setNotice(ev.message); break;
        case "context": setContextUsage(ev.usage); break;
        case "rewind.preview": setRewindPreview(ev.preview); break;
        case "rewind.result": {
          const waiter = rewindWaiterRef.current;
          rewindWaiterRef.current = null;
          waiter?.({ ok: ev.ok, ...(ev.error === undefined ? {} : { error: ev.error }) });
          break;
        }
        case "plan.proposed": setPlan(ev.text); break;
        default:
          // block.delta is the hot path — everything else is rare enough to land immediately.
          if (applyEvent(workRef.current, ev)) { if (ev.type === "block.delta") scheduleCommit(); else commit(); }
      }
    };

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(guiSocketUrl(terminalId));
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        attempt = 0;
        setConnected(true);
        if (ping) clearInterval(ping);
        ping = setInterval(() => {
          const s = wsRef.current;
          if (s && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: "ping" } satisfies GuiClientFrame));
        }, PING_EVERY_MS);
      };

      ws.onmessage = (e) => {
        let frame: GuiServerFrame;
        try { frame = JSON.parse(e.data) as GuiServerFrame; } catch { return; }
        if (frame.type === "history") {
          workRef.current = frame.messages.slice();
          setSessionId(frame.sessionId);
          applyConfig(frame.config);
          // The server re-sends whatever is still blocking the agent right after this frame, so drop
          // anything held from the previous connection — a request answered while we were away must
          // not come back as a prompt that can no longer be answered.
          setPendingApproval(null);
          setPendingQuestion(null);
          commit();
        } else if (frame.type === "event") {
          onEvent(frame.event);
        }
        // pong: keepalive only.
      };

      ws.onclose = (e) => {
        if (ping) { clearInterval(ping); ping = null; }
        // Whoever asked for a rewind is holding the user's typed text waiting on an answer that can
        // no longer come. Tell them it failed so they keep it on screen.
        const waiter = rewindWaiterRef.current;
        rewindWaiterRef.current = null;
        waiter?.({ ok: false, error: "Lost the connection — nothing was changed." });
        if (closed) return;
        setConnected(false);
        // Without a socket there's no turn to be in, and no way to learn it ended — otherwise the
        // composer would stay locked behind a stop button that can't reach anything.
        setBusy(false);
        // 1008 unauthorized / 1011 no such terminal are terminal states; retrying just loops.
        if (e.code === 1008 || e.code === 1011) return;
        attempt++;
        retry = setTimeout(connect, Math.min(1000 * attempt, MAX_BACKOFF_MS));
      };
    };

    // Tab foregrounded or the network came back: reconnect now instead of waiting out the backoff.
    const wake = () => {
      if (closed) return;
      if (!ws || ws.readyState > WebSocket.OPEN) {
        if (retry) { clearTimeout(retry); retry = null; }
        attempt = 0;
        connect();
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") wake(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", wake);

    connect();

    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", wake);
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      if (flushRef.current) { clearTimeout(flushRef.current); flushRef.current = null; }
      try { ws?.close(); } catch { /* already closing */ }
      wsRef.current = null;
    };
  }, [terminalId, applyConfig]);

  const sendFrame = useCallback((frame: GuiClientFrame) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }, []);

  // No optimistic user bubble: the contract has message.start carry `role: "user"`, so the server
  // echoes the prompt back as a turn. Appending one here would render it twice.
  const send = useCallback((text: string, images?: GuiImageAttachment[]) => {
    const value = text.trim();
    // An image on its own is a real prompt — "what is wrong with this screen" needs no words.
    if (!value && !images?.length) return;
    setPlan(null); // answering is what closes the plan card
    sendFrame({ type: "prompt", text: value, ...(images?.length ? { images } : {}) });
  }, [sendFrame]);

  const interrupt = useCallback(() => sendFrame({ type: "interrupt" }), [sendFrame]);

  const dismissPlan = useCallback(() => setPlan(null), []);

  // Clear the prompt locally as well as on the server's approval.resolved echo, so the buttons can't
  // be pressed twice while the round trip is in flight.
  const approve = useCallback((id: string, decision: GuiApprovalDecision) => {
    sendFrame({ type: "approve", id, decision });
    setPendingApproval((p) => (p && p.id === id ? null : p));
  }, [sendFrame]);

  const answer = useCallback((id: string, answers: Record<string, string[]>) => {
    sendFrame({ type: "answer", id, answers });
    setPendingQuestion((p) => (p && p.id === id ? null : p));
  }, [sendFrame]);

  // Resolves when the server rules on the rewind, so the caller can hold the user's typed text until
  // it knows the edit actually landed. One rewind can be outstanding at a time (the row's controls are
  // disabled while one is in flight), so a single slot is enough.
  const rewind = useCallback((userTurnsAfter: number, text: string, newText?: string, restoreFiles?: boolean) => {
    rewindWaiterRef.current?.({ ok: false, error: "Superseded by another rewind." });
    const settled = new Promise<GuiRewindResult>((resolve) => { rewindWaiterRef.current = resolve; });
    sendFrame({
      type: "rewind", userTurnsAfter, text,
      ...(newText === undefined ? {} : { newText }),
      ...(restoreFiles ? { restoreFiles: true } : {}),
    });
    return settled;
  }, [sendFrame]);

  const previewRewind = useCallback((userTurnsAfter: number, text: string) => {
    sendFrame({ type: "rewind.preview", userTurnsAfter, text });
  }, [sendFrame]);

  // Config travels over REST, not the socket — the server may have to restart the agent to apply it,
  // and it answers with the config it actually stored (which can differ from the patch). Paint the
  // change immediately so a pill never lags a click, and put the old value back if the PATCH fails.
  const setConfig = useCallback(async (patch: Partial<GuiConfig>) => {
    const prev = configRef.current;
    if (!prev) return; // nothing to patch onto yet — the pills aren't rendered in this state anyway
    const epoch = epochRef.current;
    applyConfig({ ...prev, ...patch });
    try {
      const { config: saved } = await api.setGuiConfig(terminalId, patch);
      if (epochRef.current === epoch) applyConfig(saved);
    } catch (e) {
      if (epochRef.current !== epoch) return;
      applyConfig(prev);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [terminalId, applyConfig]);

  return {
    messages, busy, state, connected, sessionId, error, pendingApproval, pendingQuestion, config,
    plan, contextUsage, costUsd, notice, dismissPlan, rewindPreview,
    send, interrupt, approve, answer, rewind, previewRewind, setConfig,
  };
}
