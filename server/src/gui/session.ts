import { randomUUID } from "node:crypto";
import { query, type ModelInfo, type Options, type PermissionResult, type Query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { cleanShellEnv } from "../tmux/cleanEnv.js";
import { createNormalizer } from "./normalize.js";
import { createTranscript } from "./transcript.js";
import {
  countHumanTurns, findForkPoint, truncateMessages, type ForkPoint, type RewindTarget,
} from "./rewind.js";
import { createGuiCheckpointer } from "./checkpointer.js";
import { checkImages, imageContentBlock } from "./images.js";
import { loadHistory, transcriptPathFor, DEFAULT_HISTORY_LIMIT } from "./history.js";
import { parseSessionEntries } from "../claude/jsonl.js";
import type { SessionEntry } from "../claude/types.js";
import {
  applyUltrathink, bypassesApprovals, sdkEffort, sdkPermissionMode, sdkSettings, splitContextWindow,
  type GuiConfig,
} from "./config.js";
import type {
  GuiApprovalDecision, GuiApprovalRequest, GuiCommand, GuiContextUsage, GuiEvent,
  GuiImageAttachment, GuiMessage, GuiModel, GuiQuestion, GuiQuestionRequest,
  GuiRewindPreview, GuiSessionState, GuiTurnStatus,
} from "./types.js";

// One live Claude, driven headlessly by the Agent SDK, backing one GUI-mode terminal.
//
// The SDK spawns the real `claude` binary in stream-json mode and we talk to it over stdio. The
// prompt side is an async iterable rather than a one-shot string: keeping the iterable open keeps
// the agent loop alive, so a second message mid-turn steers the SAME conversation instead of
// starting a new process. That's also what makes interrupt/approve meaningful.
//
// The terminal's tmux session is untouched by all of this — see switch.ts for the handoff.

/** Tools whose approval prompt we render ourselves instead of as a generic allow/deny. */
/** How long a stop waits for the agent to honour it before the run is ended outright. Long enough to
 *  cover a tool call that was already in flight when the button was pressed, short enough that a stop
 *  that did nothing is never something the user has to sit and watch. */
const HARD_STOP_GRACE_MS = 4000;

const ASK_USER_QUESTION = "AskUserQuestion";
const EXIT_PLAN_MODE = "ExitPlanMode";

/** Denial text sent back for a captured plan. Claude reads this and stops, which is the point:
 *  the plan belongs to the user, not to an auto-approved edit spree. */
const PLAN_CAPTURED =
  "The client captured your proposed plan and is showing it to the user. Stop here and wait for their feedback.";

export interface GuiSessionOptions {
  terminalId: string;
  /** Working directory for the agent — the workspace folder. */
  cwd: string;
  /** Resume this Claude session when set; otherwise a fresh id is generated and pinned. */
  resumeSessionId?: string | null;
  /** The composer's model / reasoning / permission picks this session starts under. */
  config: GuiConfig;
  /** Called whenever the durable Claude session id becomes known or changes. */
  onSessionId?: (sessionId: string) => void;
  /** The agent finished a turn, or is blocked waiting on the user. Wired to the same notifier a
   *  tmux pane's bell reaches, so a GUI chat alerts identically. Fires with no browser attached —
   *  that's the whole point — so it must NOT be driven from a socket subscription. */
  onAttention?: () => void;
}

export interface GuiSession {
  readonly terminalId: string;
  state(): GuiSessionState;
  /** The Claude session id this conversation lives under. Known from start for a fresh session. */
  sessionId(): string | null;
  /** The WHOLE conversation — what a reconnecting client is replayed from. Async because a resumed
   *  conversation starts on disk: this session only folded the turns it streamed itself, and handing
   *  a refreshing browser just those would shrink the chat to "everything since the agent last
   *  started". Capped to the newest {@link DEFAULT_HISTORY_LIMIT} messages, same as a cold open. */
  history(): Promise<GuiMessage[]>;
  /** Requests still blocking the agent, as the events that raised them — plus the turn still in
   *  flight, if any. A question or approval is answered by a client that may not have existed when
   *  it was asked (tab switch, refresh, second browser), so a reconnecting client has to be told
   *  about it again or the chat sits waiting on a prompt nobody can see. */
  pending(): GuiEvent[];
  /** Subscribe to the event stream. Returns an unsubscribe. */
  subscribe(fn: (event: GuiEvent) => void): () => void;
  /** Queue a user turn. Safe to call while a turn is running — it steers the same loop. Images are
   *  attached to the same message; anything invalid is reported and the turn is not sent. */
  prompt(text: string, images?: unknown): void;
  interrupt(): Promise<void>;
  /** Cut the conversation back to an earlier user turn, optionally re-sending it with new wording.
   *  Forks rather than truncates, so the original transcript survives on disk. */
  rewind(target: RewindTarget & { newText?: string; restoreFiles?: boolean }): Promise<{ ok: true } | { ok: false; error: string }>;
  /** What "undo file changes" would do to the working tree if that rewind ran right now. Read-only:
   *  the chat asks before the user commits to it, because the undo deletes files. */
  previewRewind(target: RewindTarget): Promise<GuiRewindPreview>;
  resolveApproval(id: string, decision: GuiApprovalDecision): void;
  resolveQuestion(id: string, answers: Record<string, string[]>): void;
  /** The model catalog of the installed CLI, never a baked-in list. Empty until a runtime is up. */
  models(): Promise<GuiModel[]>;
  /** How full the context window is, as the CLI itself measures it. Null before a runtime exists. */
  contextUsage(): Promise<GuiContextUsage | null>;
  /** Slash commands the installed CLI offers — skills, built-ins, plugins. Empty until a runtime is up. */
  commands(): Promise<GuiCommand[]>;
  /** The composer picks currently in effect. */
  config(): GuiConfig;
  /** Apply new picks to the live agent. Returns the config actually in effect afterwards — the
   *  requested one, or the unchanged previous one when the CLI rejected the switch. Callers persist
   *  what comes back, so a rejected change can never leave the row disagreeing with the agent. */
  setConfig(next: GuiConfig): Promise<GuiConfig>;
  stop(): Promise<void>;
}

/** A promise plus its resolver, for a request that blocks the SDK until the UI answers. The request
 *  itself is kept so a client that connects while it's outstanding can be shown it. */
interface Pending<T, R> { resolve: (value: T) => void; request: R }

/** Minimal unbounded async queue: the SDK pulls user messages from this as an async iterable. */
function createPromptQueue() {
  const items: SDKUserMessage[] = [];
  let waiting: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  let closed = false;

  return {
    push(message: SDKUserMessage) {
      if (closed) return;
      if (waiting) { const w = waiting; waiting = null; w({ value: message, done: false }); }
      else items.push(message);
    },
    close() {
      closed = true;
      if (waiting) { const w = waiting; waiting = null; w({ value: undefined as never, done: true }); }
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
        return {
          next(): Promise<IteratorResult<SDKUserMessage>> {
            const next = items.shift();
            if (next) return Promise.resolve({ value: next, done: false });
            if (closed) return Promise.resolve({ value: undefined as never, done: true });
            return new Promise((resolve) => { waiting = resolve; });
          },
        };
      },
    } as AsyncIterable<SDKUserMessage>,
  };
}

type PromptQueue = ReturnType<typeof createPromptQueue>;

/** Events that only exist because the agent is mid-turn — the stream's own proof it is working. */
function opensTurn(event: GuiEvent): boolean {
  switch (event.type) {
    case "message.start": return event.role === "assistant";
    case "block.start": case "block.delta": case "block.input": case "block.end":
    case "tool.result": case "approval.request": case "question.request":
      return true;
    default: return false;
  }
}

function userMessage(text: string, images: GuiImageAttachment[] = []): SDKUserMessage {
  // A plain string when there is nothing attached — the shape the CLI has always been given.
  const content = images.length
    ? [...images.map(imageContentBlock), { type: "text" as const, text }]
    : text;
  return {
    type: "user",
    message: { role: "user", content } as SDKUserMessage["message"],
    parent_tool_use_id: null,
  };
}

/** Pull the question list out of an AskUserQuestion tool input, or null when it isn't one. */
function parseQuestions(input: Record<string, unknown>): GuiQuestion[] | null {
  const raw = input.questions;
  if (!Array.isArray(raw)) return null;
  const questions: GuiQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const rec = q as Record<string, unknown>;
    const question = typeof rec.question === "string" ? rec.question : "";
    if (!question) continue;
    const options = Array.isArray(rec.options)
      ? rec.options.flatMap((o) => {
          if (!o || typeof o !== "object") return [];
          const or = o as Record<string, unknown>;
          return typeof or.label === "string"
            ? [{ label: or.label, description: typeof or.description === "string" ? or.description : "" }]
            : [];
        })
      : [];
    questions.push({
      // The id MUST be the question text verbatim: the SDK matches answers back to questions by
      // text, so a shortened or normalised id silently loses the answer.
      id: question,
      question,
      header: typeof rec.header === "string" ? rec.header : "",
      multiSelect: rec.multiSelect === true,
      options,
    });
  }
  return questions.length ? questions : null;
}

/** Best-effort plain text for a plan captured from ExitPlanMode. */
function planText(input: Record<string, unknown>): string {
  return typeof input.plan === "string" ? input.plan : "";
}

function sameConfig(a: GuiConfig, b: GuiConfig): boolean {
  return a.model === b.model && a.effort === b.effort
    && a.permissionMode === b.permissionMode && a.fastMode === b.fastMode;
}

/** One CLI-reported model → one picker row. `supportsContext1m` is derived from the id the CLI
 *  actually listed: a `[1m]` row is the only proof a 200k/1M toggle exists for that model. */
function toGuiModel(info: ModelInfo): GuiModel {
  const { base, oneM } = splitContextWindow(info.value);
  return {
    value: info.value,
    displayName: info.displayName,
    description: info.description,
    supportsEffort: info.supportsEffort === true,
    effortLevels: info.supportedEffortLevels ?? [],
    supportsFastMode: info.supportsFastMode === true,
    supportsContext1m: oneM,
    base,
  };
}

export function createGuiSession(opts: GuiSessionOptions): GuiSession {
  const subscribers = new Set<(event: GuiEvent) => void>();
  const normalizer = createNormalizer();
  const transcript = createTranscript();
  const approvals = new Map<string, Pending<PermissionResult, GuiApprovalRequest>>();
  const questions = new Map<string, Pending<Record<string, string[]>, GuiQuestionRequest>>();

  let state: GuiSessionState = "starting";
  // A fresh session's id is generated here rather than discovered later, so the terminal is bound to
  // its conversation from the very first frame (and a crash before the first reply is still resumable).
  let sessionId: string = opts.resumeSessionId || randomUUID();
  let runtime: Query | null = null;
  let stopped = false;
  let currentTurnId: string | null = null;
  let config: GuiConfig = opts.config;
  // Resuming an id the CLI never wrote a transcript for fails outright, so a restart before the
  // first turn re-pins the same id instead of resuming it.
  let conversationStarted = Boolean(opts.resumeSessionId);
  // `allowDangerouslySkipPermissions` is fixed at query start, so a run that didn't opt in can never
  // be talked into full access afterwards — only a restart can. Tracked per run, not per config.
  let startedWithBypass = bypassesApprovals(opts.config);
  // Which run of the agent loop is current. A restart bumps it so the outgoing pump's tail (its
  // "stopped"/"error" bookkeeping) can't clobber the state of the run that replaced it.
  let generation = 0;
  // Bumped by every stop. A prompt that was mid-snapshot when the user pressed stop compares this
  // against the value it captured and drops itself instead of starting a turn nobody asked for.
  let interruptEpoch = 0;
  let promptQueue = createPromptQueue();
  // Everything this conversation said BEFORE this session process existed. The transcript below only
  // folds events this session emitted, so without a seed a reconnecting client would be handed the
  // tail of the conversation and lose every turn that ran under an earlier session (or an earlier
  // hub). Read once, at construction — the CLI writes a turn to disk only after it ends, so nothing
  // this session goes on to stream can already be in here.
  let prefix: GuiMessage[] = [];
  const prefixReady: Promise<void> = opts.resumeSessionId
    ? loadHistory(opts.resumeSessionId, opts.cwd).then((loaded) => { prefix = loaded; }).catch(() => {})
    : Promise.resolve();

  /** Prefix + live fold, newest-capped. The one answer to "what is this conversation". */
  const wholeConversation = async (): Promise<GuiMessage[]> => {
    await prefixReady;
    const all = [...prefix, ...transcript.messages()];
    return all.length > DEFAULT_HISTORY_LIMIT ? all.slice(-DEFAULT_HISTORY_LIMIT) : all;
  };

  const emit = (event: GuiEvent) => {
    // Record before delivering: the session outlives every socket, so this copy is what a client
    // that reconnects mid-conversation is replayed from.
    transcript.apply(event);
    for (const fn of subscribers) {
      try { fn(event); } catch { /* a dead subscriber must never break the stream */ }
    }
  };

  const setState = (next: GuiSessionState) => {
    if (state === next) return;
    state = next;
    emit({ type: "state", state: next });
  };

  const setSessionId = (next: string) => {
    if (!next || sessionId === next) return;
    sessionId = next;
    opts.onSessionId?.(next);
    emit({ type: "session", sessionId: next });
  };

  const fail = (err: unknown, fallback: string) =>
    emit({ type: "error", message: err instanceof Error ? err.message : fallback });

  // The SDK blocks on this promise until the browser answers, which is exactly what gives the GUI
  // real Allow/Deny buttons instead of a keystroke sent at a TUI menu.
  const canUseTool: Options["canUseTool"] = async (toolName, input, options) => {
    if (stopped) return { behavior: "deny", message: "Session stopped." };

    if (toolName === ASK_USER_QUESTION) {
      const parsed = parseQuestions(input);
      if (parsed) {
        const request: GuiQuestionRequest = { id: randomUUID(), questions: parsed };
        const answers = await new Promise<Record<string, string[]>>((resolve) => {
          questions.set(request.id, { resolve, request });
          options.signal.addEventListener("abort", () => {
            if (questions.delete(request.id)) resolve({});
          }, { once: true });
          setState("waiting");
          emit({ type: "question.request", request });
          opts.onAttention?.();
        });
        emit({ type: "question.resolved", id: request.id });
        setState("running");
        return { behavior: "allow", updatedInput: { questions: parsed, answers } };
      }
    }

    if (toolName === EXIT_PLAN_MODE) {
      const text = planText(input);
      if (text) emit({ type: "plan.proposed", text });
      return { behavior: "deny", message: PLAN_CAPTURED };
    }

    const id = randomUUID();
    const suggestions = options.suggestions ?? [];
    const request: GuiApprovalRequest = {
      id, toolName, input, canAllowForSession: suggestions.length > 0,
    };
    const result = await new Promise<PermissionResult>((resolve) => {
      approvals.set(id, { resolve, request });
      options.signal.addEventListener("abort", () => {
        if (approvals.delete(id)) resolve({ behavior: "deny", message: "Cancelled." });
      }, { once: true });
      setState("waiting");
      emit({ type: "approval.request", request });
      opts.onAttention?.();
    });
    setState("running");
    // An "allow for session" carries the SDK's own permission suggestions back, which is what makes
    // the allowance stick for the rest of the conversation rather than just this one call.
    if (result.behavior === "allow" && result.updatedPermissions === undefined && suggestions.length) {
      return { ...result, updatedInput: input };
    }
    if (result.behavior === "allow") return { ...result, updatedInput: result.updatedInput ?? input };
    return result;
  };

  // Rebuilt per run: model, effort, permission mode and the bypass opt-in are all query-start
  // options, so changing the ones that have no live setter means starting a new run.
  // Set by a rewind: the next run resumes the conversation truncated at this chain entry and forks
  // it into `sessionId`, leaving the original transcript on disk untouched.
  let forkFrom: { resume: string; at: string } | null = null;

  /** The conversation as it stands on disk. A fork that hasn't written a turn of its own yet still
   *  lives in the file it came from, cut at the fork point — reading the fork's own (missing) file
   *  would report an empty conversation. */
  const conversationEntries = async (): Promise<
    { ok: true; entries: SessionEntry[] } | { ok: false; error: string }
  > => {
    const pending = forkFrom;
    const file = await transcriptPathFor(pending?.resume ?? sessionId, opts.cwd);
    if (!file) return { ok: false, error: "This conversation has no transcript to rewind." };
    let entries: SessionEntry[];
    try { entries = await parseSessionEntries(file, "claude"); }
    catch { return { ok: false, error: "Could not read this conversation's transcript." }; }
    if (pending) {
      const cut = entries.findIndex((e) => e.uuid === pending.at);
      if (cut >= 0) entries = entries.slice(0, cut + 1);
    }
    return { ok: true, entries };
  };

  // Workspace snapshots, taken before each turn so a rewind can undo everything the turn touched —
  // not just the files the agent edited through a tool. Scoped to the terminal, which is the one id
  // that survives the session forks a rewind creates.
  const checkpoints = createGuiCheckpointer({
    scopeId: opts.terminalId,
    cwd: opts.cwd,
    resumed: conversationStarted,
    priorTurns: async () => {
      const found = await conversationEntries();
      return found.ok ? countHumanTurns(found.entries) : null;
    },
  });

  const buildOptions = (cfg: GuiConfig): Options => {
    const effort = sdkEffort(cfg.effort);
    const settings = sdkSettings(cfg);
    const permissionMode = sdkPermissionMode(cfg.permissionMode);
    return {
      cwd: opts.cwd,
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(effort ? { effort } : {}),
      ...(Object.keys(settings).length ? { settings } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(bypassesApprovals(cfg) ? { allowDangerouslySkipPermissions: true } : {}),
      // The user's own ~/.claude settings apply, so their existing allow-rules, hooks and MCP servers
      // behave here exactly as they do in the pane. Without this the GUI would feel like a different
      // agent than the terminal it replaced.
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      // Deltas — without this the SDK only emits whole messages and the chat lands in lumps.
      includePartialMessages: true,
      canUseTool,
      // Backups are taken as files are modified, so this has to be on from the start of the run —
      // it cannot be switched on retroactively when someone asks to undo an edit.
      enableFileCheckpointing: true,
      // Same denylist the tmux panes use, so the hub's own PORT/NODE_ENV/token never reach the agent.
      env: cleanShellEnv() as Record<string, string>,
      ...(forkFrom
        ? { resume: forkFrom.resume, resumeSessionAt: forkFrom.at, forkSession: true, sessionId }
        : conversationStarted ? { resume: sessionId } : { sessionId }),
    };
  };

  /**
   * The one way a run ends without a `result` frame — the stream failed, the CLI exited, or the
   * session was torn down under it. Every such path funnels here rather than settling its own
   * bookkeeping, so a turn can never end in more than one shape: in-flight tool cards inherit the
   * outcome, and the turn itself is closed out. Without the turn.end, the chat would keep a turn
   * open forever and nothing keyed off a turn boundary would ever fire again.
   */
  const endRun = (status: GuiTurnStatus) => {
    for (const event of normalizer.settleOpenTools("aborted")) emit(event);
    if (!currentTurnId) return;
    const turnId = currentTurnId;
    currentTurnId = null;
    emit({ type: "turn.end", turnId, status });
  };

  const pump = async (gen: number, queue: PromptQueue, options: Options) => {
    try {
      const q = query({ prompt: queue.iterable, options });
      if (stopped || gen !== generation) { void q.return(undefined).catch(() => {}); return; }
      runtime = q;
      setState("idle");
      for await (const message of q) {
        if (stopped || gen !== generation) break;
        for (const event of normalizer.push(message)) {
          if (event.type === "session") { setSessionId(event.sessionId); continue; }
          // The agent is producing something and no turn is open, so one opens here. Without this a
          // turn is only ever "running" because the browser that sent the prompt said so — and that
          // fact dies with the socket: refresh mid-turn and the reconnecting client is told "idle"
          // while text is still pouring in (no stop button, no working indicator). Anything the
          // agent streams is proof a turn is in flight, whoever asked for it and however long ago.
          if (event.type !== "turn.end" && !currentTurnId && opensTurn(event)) {
            currentTurnId = randomUUID();
            emit({ type: "turn.start", turnId: currentTurnId });
            setState("running");
          }
          if (event.type === "turn.start") { currentTurnId = event.turnId; setState("running"); }
          if (event.type === "turn.end") {
            currentTurnId = null;
            setState("idle");
            // The forked session has now written a turn, so it has a transcript of its own and a
            // later restart can resume it plainly instead of re-forking the conversation it came from.
            forkFrom = null;
            // An interrupted turn is the user's own stop — a pane doesn't ring for that either.
            if (event.status === "completed") opts.onAttention?.();
            // The window only moves when a turn does, so this is the one place worth asking.
            void readContextUsage().then((usage) => { if (usage) emit({ type: "context", usage }); });
          }
          emit(event);
        }
      }
      if (!stopped && gen === generation) { endRun("interrupted"); setState("stopped"); }
    } catch (err) {
      if (stopped || gen !== generation) return;
      endRun("failed");
      setState("error");
      fail(err, "agent session failed");
    }
  };
  void pump(generation, promptQueue, buildOptions(config));
  // Bind the terminal to its conversation NOW, not when the CLI first reports the id back. Until
  // this lands, a reconnect (or a hub restart) has nothing to resume and the chat comes back empty.
  if (!opts.resumeSessionId) opts.onSessionId?.(sessionId);

  /** Release everything blocking the agent loop, then wind the current runtime down. Without this
   *  the child never reaches its exit path and a restart would leave two CLIs on one conversation. */
  const teardown = async (queue: PromptQueue, reason: string) => {
    for (const [, p] of approvals) p.resolve({ behavior: "deny", message: reason });
    approvals.clear();
    for (const [, p] of questions) p.resolve({});
    questions.clear();
    endRun("interrupted");
    queue.close();
    const old = runtime;
    runtime = null;
    try { await old?.return(undefined); } catch { /* generator already finished */ }
  };

  /** Start a fresh run under `cfg`, carrying the conversation over by resuming its session id. The
   *  session object itself survives, so subscribers, state and the terminal binding are untouched —
   *  a viewer sees a config change, not a chat that vanished and came back. */
  const restart = async (cfg: GuiConfig, reason = "Restarting the agent to change permissions.") => {
    generation += 1;
    const gen = generation;
    // Swap the queue in before the old run is wound down, so a turn typed during the handoff lands
    // in the new run instead of the closed queue — the composer already echoed it.
    const old = promptQueue;
    promptQueue = createPromptQueue();
    await teardown(old, reason);
    if (stopped || gen !== generation) return;
    startedWithBypass = bypassesApprovals(cfg);
    void pump(gen, promptQueue, buildOptions(cfg));
  };

  /** The CLI's own context accounting. Never derived from token counts here: the window also holds
   *  the system prompt, tools, skills and memory files, so anything computed from usage deltas would
   *  read low and get worse as the session grows. */
  const readContextUsage = async (): Promise<GuiContextUsage | null> => {
    if (!runtime) return null;
    try {
      const usage = await runtime.getContextUsage();
      return {
        usedTokens: usage.totalTokens,
        maxTokens: usage.maxTokens,
        percentage: usage.percentage,
        autoCompact: usage.isAutoCompactEnabled,
      };
    } catch {
      return null; // an older CLI without the control request must not break the panel
    }
  };

  /** Queue a user turn and echo it into the transcript. */
  function sendPrompt(text: string, rawImages?: unknown): void {
    const checked = checkImages(rawImages);
    if (!checked.ok) { emit({ type: "error", message: checked.error }); return; }
    const images = checked.images;
    // Ultrathink is a prompt keyword, not a flag, so the depth setting rewrites the turn itself.
    // The echo below sends the rewritten text — showing the raw input would put a transcript in
    // front of the user that isn't the one Claude was given.
    const sent = applyUltrathink(text, config.effort);
    // An image with no words is still a turn worth sending — "look at this" is the whole prompt.
    if (stopped || (!sent && !images.length)) return;
    const turnId = randomUUID();
    currentTurnId = turnId;
    conversationStarted = true;
    // Echo the user's own turn immediately. The SDK does not replay it back to us, and waiting for
    // the first assistant delta to redraw would make the composer feel dead for a second or two.
    const messageId = randomUUID();
    emit({ type: "message.start", id: messageId, role: "user", ts: Date.now() });
    images.forEach((image, i) => {
      const id = `${messageId}:img${i}`;
      emit({ type: "block.start", messageId, block: { kind: "image", id, ...image } });
      emit({ type: "block.end", messageId, blockId: id });
    });
    emit({ type: "block.start", messageId, block: { kind: "text", id: `${messageId}:0`, text: sent } });
    emit({ type: "block.end", messageId, blockId: `${messageId}:0` });
    emit({ type: "message.end", id: messageId });
    emit({ type: "turn.start", turnId });
    setState("running");
    // Snapshot the workspace BEFORE the agent is handed the turn — a baseline taken afterwards would
    // already contain the turn's own edits. The echo above has already landed, so the composer feels
    // instant either way; only the agent waits, and only for as long as one `git add -A` takes.
    // `promptQueue` is read after the await on purpose: a restart in between swaps the queue, and the
    // turn belongs in the run that exists now, not the one that was closed.
    const epoch = interruptEpoch;
    void checkpoints.beforeTurn(sent)
      .catch(() => {})
      .then(() => {
        // Stopped while the snapshot was being taken: the turn was cancelled before it ever ran.
        if (stopped || interruptEpoch !== epoch) return;
        promptQueue.push(userMessage(sent, images));
      });
  }

  /**
   * Put the working tree back to how the dropped turn found it.
   *
   * The workspace snapshot goes first because it is the only one that covers everything: a turn can
   * change files through a shell command, an install, a formatter or a migration, and none of those
   * are files the agent "edited". The agent's own per-file backups are the fallback for a workspace
   * git isn't watching — narrower, but better than refusing.
   */
  const undoFiles = async (point: ForkPoint, text: string): Promise<string> => {
    const snapshot = await checkpoints.restore(point.turnIndex, text);
    if (snapshot.ok) {
      const { files, insertions, deletions, removed } = snapshot.stat;
      const deleted = removed ? `, ${removed} new file${removed === 1 ? "" : "s"} deleted` : "";
      return `Reverted ${files} file${files === 1 ? "" : "s"} (+${insertions}/-${deletions})${deleted}.`;
    }
    const failed = (why: string) =>
      `Could not undo file changes: ${why}. Workspace snapshot: ${snapshot.reason}.`;
    if (!point.targetUuid) return failed("that turn has no checkpoint");
    try {
      const result = await runtime?.rewindFiles(point.targetUuid);
      if (!result) return failed("the agent is not running");
      if (!result.canRewind) return failed(result.error ?? "no checkpoint for that message");
      const count = result.filesChanged?.length ?? 0;
      const skipped = result.skippedLinks ? ` ${result.skippedLinks} skipped (symlink or moved).` : "";
      return `Reverted ${count} file${count === 1 ? "" : "s"} (+${result.insertions ?? 0}/-${result.deletions ?? 0}).${skipped}`;
    } catch (err) {
      return failed(err instanceof Error ? err.message : "the CLI refused");
    }
  };

  return {
    terminalId: opts.terminalId,
    state: () => state,
    sessionId: () => sessionId,
    history: wholeConversation,

    subscribe(fn) {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },

    prompt: sendPrompt,

    async interrupt() {
      if (!runtime || stopped) return;
      // Anything still on its way INTO the run counts as stopped too. A prompt waits on its workspace
      // snapshot before it is queued, so without this a stop pressed during that wait lets the turn
      // start a moment later — the agent carries on and it reads as a stop that did nothing.
      interruptEpoch += 1;
      const epoch = interruptEpoch;
      try { await runtime.interrupt(); } catch { /* nothing in flight, or the CLI is already gone */ }
      if (currentTurnId) {
        emit({ type: "turn.end", turnId: currentTurnId, status: "interrupted" });
        currentTurnId = null;
      }
      setState("idle");

      // Asking is not the same as stopping. If the agent is still producing after the grace period —
      // a turn re-opens the moment anything streams, so an open turn here means it ignored us — the
      // run is torn down and the conversation resumed in a fresh one. That is a real stop: the CLI
      // holding the turn is gone. Nothing is lost that a stop wasn't already discarding.
      setTimeout(() => {
        if (stopped || interruptEpoch !== epoch || !currentTurnId) return;
        emit({ type: "notice", message: "The agent didn't stop on request — its run was ended." });
        void restart(config, "Stopped.").catch(() => {});
      }, HARD_STOP_GRACE_MS);
    },

    pending() {
      return [
        // The open turn first: a client that arrives mid-turn has to learn the agent is working
        // before it is shown what the agent is blocked on, or it renders an approval bar under an
        // idle-looking composer.
        ...(currentTurnId ? [{ type: "turn.start", turnId: currentTurnId } as GuiEvent] : []),
        ...[...questions.values()].map((p): GuiEvent => ({ type: "question.request", request: p.request })),
        ...[...approvals.values()].map((p): GuiEvent => ({ type: "approval.request", request: p.request })),
      ];
    },

    async rewind(target) {
      // A turn still in flight has entries the transcript on disk hasn't been given yet, so the fork
      // point would be computed against a stale file. Same rule the pane/GUI switch uses: stop it
      // first. (The composer disables these controls while busy; this is the server-side backstop.)
      if (state === "running" || state === "waiting") {
        return { ok: false as const, error: "The agent is working — stop it first." };
      }
      if (!conversationStarted) return { ok: false as const, error: "Nothing to rewind yet." };

      // A fork that hasn't completed a turn yet has written nothing of its own: the conversation it
      // represents is still the original file, cut at the pending fork point. Read that instead, or
      // a second rewind before the first reply would find no transcript at all.
      const loaded = await conversationEntries();
      if (!loaded.ok) return { ok: false as const, error: loaded.error };

      const found = findForkPoint(loaded.entries, target);
      if (!found.ok) return { ok: false as const, error: found.error };

      // What the chat should show afterwards — the whole conversation, disk prefix included, or the
      // cut would be measured against only the turns this session happened to stream.
      const base = await wholeConversation();
      const source = base.length ? base : await loadHistory(sessionId, opts.cwd);
      const kept = truncateMessages(source, target.userTurnsAfter);
      if (!kept) return { ok: false as const, error: "That message is no longer in this conversation." };

      // Files first, while the runtime that took the agent's own backups is still alive — a restart
      // drops those. Reverting the working tree is opt-in per rewind: dropping a message is not the
      // same request as throwing away the code it produced.
      if (target.restoreFiles) emit({ type: "notice", message: await undoFiles(found.point, target.text) });
      // The turns past the cut no longer exist, so neither should the snapshots taken in front of
      // them. The target's own snapshot stays: it is what "undo back to this message" still means.
      await checkpoints.cutTo(found.point.turnIndex);

      // Read before `forkFrom` is reassigned below: a fork of a fork resumes the file the FIRST one
      // came from, because the intermediate session never wrote a transcript of its own.
      const from = forkFrom?.resume ?? sessionId;
      // A fork is a different conversation, so it gets a different id and the terminal is rebound to
      // it. The original file stays where it is — a rewind must never be the thing that loses work.
      const forked = randomUUID();
      if (found.point.uuid) {
        forkFrom = { resume: from, at: found.point.uuid };
        sessionId = forked;
        conversationStarted = true;
      } else {
        // Nothing survives the cut, so there is nothing to fork FROM — start the conversation over.
        forkFrom = null;
        sessionId = forked;
        conversationStarted = false;
      }
      opts.onSessionId?.(sessionId);
      emit({ type: "session", sessionId });
      // `kept` is the whole surviving conversation, so the transcript now holds all of it — leaving
      // the disk prefix in place would replay the pre-rewind turns a second time on the next connect.
      prefix = [];
      emit({ type: "history.reset", messages: kept });

      await restart(config, "Rewinding the conversation.");
      const next = target.newText?.trim();
      if (next) sendPrompt(next);
      return { ok: true as const };
    },

    async previewRewind(target) {
      const unknown = (reason: string): GuiRewindPreview => ({
        userTurnsAfter: target.userTurnsAfter, available: false,
        files: 0, insertions: 0, deletions: 0, removed: 0, reason,
      });
      if (!conversationStarted) return unknown("nothing has run yet");
      const loaded = await conversationEntries();
      if (!loaded.ok) return unknown(loaded.error);
      const found = findForkPoint(loaded.entries, target);
      if (!found.ok) return unknown(found.error);
      const snapshot = await checkpoints.preview(found.point.turnIndex, target.text);
      if (!snapshot.ok) return unknown(snapshot.reason);
      return { userTurnsAfter: target.userTurnsAfter, available: true, ...snapshot.stat };
    },

    resolveApproval(id, decision) {
      const pending = approvals.get(id);
      if (!pending) return;
      approvals.delete(id);
      emit({ type: "approval.resolved", id, decision });
      if (decision === "deny") pending.resolve({ behavior: "deny", message: "User declined tool execution." });
      else pending.resolve({ behavior: "allow" });
    },

    resolveQuestion(id, answers) {
      const pending = questions.get(id);
      if (!pending) return;
      questions.delete(id);
      pending.resolve(answers);
    },

    contextUsage: readContextUsage,

    async commands() {
      if (!runtime) return [];
      try {
        return (await runtime.supportedCommands()).map((c) => ({
          name: c.name, description: c.description, argumentHint: c.argumentHint,
        }));
      } catch { return []; }
    },

    async models() {
      if (!runtime) return [];
      // Never throw: the picker asking too early, or an older CLI without the control request, must
      // degrade to "no choices yet" rather than failing the whole panel.
      try { return (await runtime.supportedModels()).map(toGuiModel); } catch { return []; }
    },

    config: () => config,

    async setConfig(next) {
      const prev = config;
      if (sameConfig(prev, next)) return prev;
      try {
        if (bypassesApprovals(next) && !startedWithBypass) {
          config = next;
          await restart(next);
        } else {
          // Model first: it's the only setter the CLI validates, so a bad id fails before anything
          // else has moved and the session is left exactly as it was.
          if (next.model !== prev.model) await runtime?.setModel(next.model ?? undefined);
          if (next.effort !== prev.effort || next.fastMode !== prev.fastMode) {
            const settings = sdkSettings(next);
            // `null` clears a key from the flag layer; omitting it would leave the old value in
            // place, so turning ultracode/fast mode back off has to be spelled out.
            await runtime?.applyFlagSettings({
              effortLevel: sdkEffort(next.effort) ?? null,
              ultracode: settings.ultracode ?? null,
              fastMode: settings.fastMode ?? null,
            });
          }
          if (next.permissionMode !== prev.permissionMode) {
            await runtime?.setPermissionMode(sdkPermissionMode(next.permissionMode) ?? "default");
          }
          config = next;
        }
      } catch (err) {
        // Keep the old config: a switch the CLI refused must not leave the UI showing a setting the
        // agent isn't actually running under.
        config = prev;
        fail(err, "could not apply the new settings");
      }
      emit({ type: "config", config });
      return config;
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      await teardown(promptQueue, "Session stopped.");
      setState("stopped");
      subscribers.clear();
    },
  };
}
