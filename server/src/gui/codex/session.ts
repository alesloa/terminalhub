import { randomUUID } from "node:crypto";
import { startCodexAppServer, type CodexAppServer } from "../../codex/appServer.js";
import {
  CODEX_METHOD, CODEX_NOTIFICATION, CODEX_SERVER_REQUEST,
  type CodexApprovalDecision, type CodexCommandApprovalParams, type CodexFileChangeApprovalParams,
  type CodexModelListResponse, type CodexRequestUserInputParams, type CodexThreadResponse,
  type CodexTokenUsageNotification, type CodexTurn, type CodexTurnNotification, type CodexUserInput,
} from "../../codex/protocol.js";
import { createGuiCheckpointer } from "../checkpointer.js";
import { checkImages } from "../images.js";
import { createTranscript } from "../transcript.js";
import { DEFAULT_HISTORY_LIMIT } from "../history.js";
import type { GuiSession, GuiSessionOptions } from "../session.js";
import type { GuiConfig } from "../config.js";
import type {
  GuiApprovalDecision, GuiApprovalRequest, GuiCommand, GuiContextUsage, GuiEvent,
  GuiImageAttachment, GuiMessage, GuiModel, GuiQuestion, GuiQuestionRequest, GuiRewindPreview,
  GuiSessionState,
} from "../types.js";
import { codexEffort, codexPermissions, toGuiModels } from "./config.js";
import { createCodexNormalizer, historyFromTurns, turnStatusOf } from "./normalize.js";
import { countUserTurns, listSkills } from "./thread.js";

// One live Codex, driven headlessly through `codex app-server`, backing one GUI-mode terminal.
//
// The Codex twin of gui/session.ts. Same GuiSession contract, same events on the wire, so the whole
// browser side — transcript, composer, approval bar, context meter — is shared. What differs is
// underneath: Claude is driven by the Agent SDK's streaming-input loop, Codex by a JSON-RPC thread
// that stays open across turns (see ../../codex/appServer.ts).
//
// The terminal's tmux session is untouched by all of this — see ../switch.ts for the handoff.

/** How long a stop waits for Codex to honour it before the app-server is torn down and the thread
 *  resumed in a fresh one. Matches the Claude session's grace so a stop feels the same on both. */
const HARD_STOP_GRACE_MS = 4000;

interface Pending<T, R> { resolve: (value: T) => void; request: R }

/** GUI decision → the word Codex's approval requests expect. `cancel` is deliberately unused: it
 *  denies AND interrupts the turn, which is the stop button's job, not a decline's. */
function approvalDecision(decision: GuiApprovalDecision): CodexApprovalDecision {
  if (decision === "allow") return "accept";
  if (decision === "allowForSession") return "acceptForSession";
  return "decline";
}

function textInput(text: string, images: GuiImageAttachment[]): CodexUserInput[] {
  const input: CodexUserInput[] = images.map((image) => ({
    type: "image",
    // Codex takes an image as a URL, and accepts a data: URI — which is what the browser gave us.
    // There is no file on disk to point at.
    url: `data:${image.mediaType};base64,${image.dataBase64}`,
  }));
  if (text) input.push({ type: "text", text });
  return input;
}

/** One `item/tool/requestUserInput` question → the chat's own question shape. */
function toGuiQuestions(params: CodexRequestUserInputParams): GuiQuestion[] {
  return (params.questions ?? []).map((q): GuiQuestion => ({
    id: q.id,
    question: q.question,
    header: q.header ?? "",
    // Codex's request_user_input is single-answer per question; the UI's multi-select is Claude-only.
    multiSelect: false,
    options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? "" })),
  }));
}

export function createCodexGuiSession(opts: GuiSessionOptions): GuiSession {
  const subscribers = new Set<(event: GuiEvent) => void>();
  const transcript = createTranscript();
  const normalizer = createCodexNormalizer();
  const approvals = new Map<string, Pending<CodexApprovalDecision, GuiApprovalRequest>>();
  const questions = new Map<string, Pending<Record<string, string[]>, GuiQuestionRequest>>();

  let state: GuiSessionState = "starting";
  let server: CodexAppServer | null = null;
  // The Codex thread id IS this chat's session id — it is what the terminal row stores and what a
  // reconnect or a hub restart resumes. Unknown until `thread/start` answers.
  let threadId: string | null = opts.resumeSessionId ?? null;
  let currentTurnId: string | null = null;
  /** When the open turn started, so a client that arrives late is told the truth about how long the
   *  agent has been working rather than starting its own stopwatch. */
  let turnStartedAt = 0;
  let config: GuiConfig = opts.config;
  let stopped = false;
  /** Bumped by every stop and every restart, so work that was already in flight can drop itself. */
  let interruptEpoch = 0;
  /** Which run of the app-server is current; a restart bumps it. */
  let generation = 0;
  let usage: GuiContextUsage | null = null;
  let models: GuiModel[] = [];
  let commands: GuiCommand[] = [];
  /** Everything the thread said before this session process existed. Seeded once, from the resume. */
  let prefix: GuiMessage[] = [];
  /** Human turns already on the thread when this session attached — the checkpointer's baseline. */
  let priorTurns: number | null = opts.resumeSessionId ? null : 0;

  const emit = (event: GuiEvent) => {
    transcript.apply(event);
    for (const fn of subscribers) {
      try { fn(event); } catch { /* a dead subscriber must never break the stream */ }
    }
  };

  const emitAll = (events: GuiEvent[]) => { for (const event of events) emit(event); };

  const setState = (next: GuiSessionState) => {
    if (state === next) return;
    state = next;
    emit({ type: "state", state: next });
  };

  const fail = (err: unknown, fallback: string) =>
    emit({ type: "error", message: err instanceof Error ? err.message : fallback });

  const setThreadId = (next: string) => {
    if (!next || threadId === next) return;
    threadId = next;
    opts.onSessionId?.(next);
    emit({ type: "session", sessionId: next });
  };

  // ---------------------------------------------------------------------------
  // Startup: spawn, handshake, open the thread
  // ---------------------------------------------------------------------------

  /** Resolves when a thread is open and turns can be sent. Replaced by a restart. */
  let ready: Promise<void> = Promise.resolve();

  const wireNotifications = (app: CodexAppServer, gen: number) => {
    app.onNotification((method, params) => {
      if (stopped || gen !== generation) return;
      switch (method) {
        case CODEX_NOTIFICATION.threadStarted: {
          const id = (params as { thread?: { id?: string } })?.thread?.id;
          if (id) setThreadId(id);
          return;
        }
        case CODEX_NOTIFICATION.turnStarted: {
          const turn = (params as CodexTurnNotification)?.turn;
          if (!turn?.id) return;
          currentTurnId = turn.id;
          turnStartedAt = Date.now();
          emit({ type: "turn.start", turnId: turn.id, startedAt: turnStartedAt });
          setState("running");
          return;
        }
        case CODEX_NOTIFICATION.turnCompleted: {
          const turn = (params as CodexTurnNotification)?.turn;
          const status = turnStatusOf(turn?.status);
          // Anything still spinning never reported back; settle it before the turn closes so the
          // cards stop in the same frame the composer goes idle.
          emitAll(normalizer.settleOpenTools(status === "completed" ? "ok" : "aborted"));
          emitAll(normalizer.closeMessage());
          const turnId = turn?.id ?? currentTurnId;
          currentTurnId = null;
          if (turnId) emit({ type: "turn.end", turnId, status });
          setState("idle");
          if (usage) emit({ type: "context", usage });
          // An interrupted turn is the user's own stop — a pane doesn't ring for that either.
          if (status === "completed") opts.onAttention?.();
          return;
        }
        case CODEX_NOTIFICATION.tokenUsage: {
          const payload = params as CodexTokenUsageNotification;
          const total = payload?.tokenUsage?.total;
          const max = payload?.tokenUsage?.modelContextWindow ?? 0;
          if (!total || !max) return;
          usage = {
            usedTokens: total.totalTokens,
            maxTokens: max,
            percentage: Math.min(100, Math.round((total.totalTokens / max) * 100)),
            // Codex compacts on its own when the window fills; there is no per-thread opt-out to read.
            autoCompact: true,
          };
          return;
        }
        case CODEX_NOTIFICATION.error: {
          const payload = params as { error?: { message?: string } | null; willRetry?: boolean };
          const message = payload?.error?.message || "Codex reported an error.";
          // A retryable hiccup is liveness, not a failure the transcript should keep.
          emit(payload?.willRetry ? { type: "notice", message } : { type: "error", message });
          return;
        }
        default:
          emitAll(normalizer.push(method, params));
      }
    });
  };

  const wireServerRequests = (app: CodexAppServer, gen: number) => {
    const guard = async <T>(run: () => Promise<T>, whenGone: T): Promise<T> =>
      (stopped || gen !== generation ? whenGone : run());

    const askApproval = async (
      toolName: string, input: unknown,
    ): Promise<CodexApprovalDecision> => {
      const id = randomUUID();
      const request: GuiApprovalRequest = {
        id, toolName, input,
        // Codex always offers "don't ask again for this session" on both approval kinds.
        canAllowForSession: true,
      };
      const decision = await new Promise<CodexApprovalDecision>((resolve) => {
        approvals.set(id, { resolve, request });
        setState("waiting");
        emit({ type: "approval.request", request });
        opts.onAttention?.();
      });
      setState("running");
      return decision;
    };

    app.onRequest(CODEX_SERVER_REQUEST.commandApproval, (raw) =>
      guard(async () => {
        const params = raw as CodexCommandApprovalParams;
        const decision = await askApproval("Bash", {
          command: params?.command ?? "",
          ...(params?.cwd ? { cwd: params.cwd } : {}),
          ...(params?.reason ? { reason: params.reason } : {}),
        });
        return { decision };
      }, { decision: "decline" as CodexApprovalDecision }));

    app.onRequest(CODEX_SERVER_REQUEST.fileChangeApproval, (raw) =>
      guard(async () => {
        const params = raw as CodexFileChangeApprovalParams;
        const decision = await askApproval("ApplyPatch", {
          ...(params?.reason ? { reason: params.reason } : {}),
          ...(params?.grantRoot ? { file_path: params.grantRoot } : {}),
        });
        return { decision };
      }, { decision: "decline" as CodexApprovalDecision }));

    app.onRequest(CODEX_SERVER_REQUEST.requestUserInput, (raw) =>
      guard(async () => {
        const params = raw as CodexRequestUserInputParams;
        const parsed = toGuiQuestions(params);
        if (!parsed.length) return { answers: {} };
        const request: GuiQuestionRequest = { id: randomUUID(), questions: parsed };
        const answers = await new Promise<Record<string, string[]>>((resolve) => {
          questions.set(request.id, { resolve, request });
          setState("waiting");
          emit({ type: "question.request", request });
          opts.onAttention?.();
        });
        emit({ type: "question.resolved", id: request.id });
        setState("running");
        // Codex wants { [questionId]: { answers: string[] } }, keyed by the id it sent.
        const shaped: Record<string, { answers: string[] }> = {};
        for (const q of parsed) shaped[q.id] = { answers: answers[q.id] ?? [] };
        return { answers: shaped };
      }, { answers: {} }));
  };

  /** Open (or reopen) the thread on `app`, seeding history the first time. */
  const openThread = async (app: CodexAppServer, seedHistory: boolean): Promise<void> => {
    await app.request(CODEX_METHOD.initialize, {
      clientInfo: { name: "terminalhub", title: "Terminal Hub", version: "1.0.0" },
    });
    app.notify(CODEX_METHOD.initialized);

    const permissions = codexPermissions(config.permissionMode);
    const base = {
      cwd: opts.cwd,
      approvalPolicy: permissions.approvalPolicy,
      sandbox: permissions.sandbox,
      ...(config.model ? { model: config.model } : {}),
    };

    let response: CodexThreadResponse | null = null;
    if (threadId) {
      // A thread id we were handed can be stale — the rollout file may have been archived, or the
      // terminal may have been switched from a pane whose session Codex no longer knows. Falling
      // back to a fresh thread is better than a chat that can never send anything.
      try { response = await app.request<CodexThreadResponse>(CODEX_METHOD.threadResume, { threadId, ...base }); }
      catch { response = null; }
    }
    if (!response) {
      response = await app.request<CodexThreadResponse>(CODEX_METHOD.threadStart, base);
    }

    const thread = response.thread;
    setThreadId(thread.id);
    if (seedHistory) {
      const turns: CodexTurn[] = thread.turns ?? [];
      prefix = historyFromTurns(turns);
      priorTurns = countUserTurns(turns);
    }
  };

  const start = async (gen: number, seedHistory: boolean): Promise<void> => {
    const app = startCodexAppServer({ cwd: opts.cwd });
    if (stopped || gen !== generation) { void app.close(); return; }
    server = app;
    wireNotifications(app, gen);
    wireServerRequests(app, gen);
    // The child dying mid-conversation has to surface: the composer would otherwise sit enabled and
    // silently swallow everything typed into it.
    void app.exited.then(() => {
      if (stopped || gen !== generation) return;
      emitAll(normalizer.settleOpenTools("aborted"));
      emitAll(normalizer.closeMessage());
      if (currentTurnId) { emit({ type: "turn.end", turnId: currentTurnId, status: "failed" }); currentTurnId = null; }
      setState("error");
      emit({ type: "error", message: "Codex stopped unexpectedly. Reopen the chat to start it again." });
    });

    try {
      await openThread(app, seedHistory);
      if (stopped || gen !== generation) return;
      setState("idle");
    } catch (err) {
      if (stopped || gen !== generation) return;
      setState("error");
      fail(err, "could not start Codex");
      throw err;
    }
  };

  ready = start(generation, true).catch(() => {});
  if (!opts.resumeSessionId && threadId) opts.onSessionId?.(threadId);

  /** Tear the current app-server down and open the thread again in a fresh one, carrying the
   *  conversation over by its id. Subscribers, state and the terminal binding are untouched. */
  const restart = async (reason: string): Promise<void> => {
    generation += 1;
    interruptEpoch += 1;
    const gen = generation;
    for (const [, p] of approvals) p.resolve("decline");
    approvals.clear();
    for (const [, p] of questions) p.resolve({});
    questions.clear();
    emitAll(normalizer.settleOpenTools("aborted"));
    emitAll(normalizer.closeMessage());
    if (currentTurnId) { emit({ type: "turn.end", turnId: currentTurnId, status: "interrupted" }); currentTurnId = null; }
    const old = server;
    server = null;
    await old?.close();
    if (stopped || gen !== generation) return;
    void reason;
    // Not seeded again: `prefix` already holds everything from before this session, and the live
    // transcript holds everything since. Re-reading the thread would replay the whole chat twice.
    ready = start(gen, false).catch(() => {});
    await ready;
  };

  // ---------------------------------------------------------------------------
  // Workspace snapshots — the same git checkpoints the Claude chat takes
  // ---------------------------------------------------------------------------

  const checkpoints = createGuiCheckpointer({
    scopeId: opts.terminalId,
    cwd: opts.cwd,
    resumed: Boolean(opts.resumeSessionId),
    priorTurns: async () => { await ready; return priorTurns; },
  });

  /** Prefix + live fold, newest-capped. The one answer to "what is this conversation". */
  const wholeConversation = async (): Promise<GuiMessage[]> => {
    await ready;
    const all = [...prefix, ...transcript.messages()];
    return all.length > DEFAULT_HISTORY_LIMIT ? all.slice(-DEFAULT_HISTORY_LIMIT) : all;
  };

  /** Human turns in the conversation right now — the disk prefix plus everything sent since. */
  const humanTurns = async (): Promise<number> => {
    const all = await wholeConversation();
    return all.filter((m) => m.role === "user").length;
  };

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  function sendPrompt(text: string, rawImages?: unknown): void {
    const checked = checkImages(rawImages);
    if (!checked.ok) { emit({ type: "error", message: checked.error }); return; }
    const images = checked.images;
    const sent = text.trim();
    if (stopped || (!sent && !images.length)) return;

    // Echo the user's own turn immediately: Codex does replay it back as a `userMessage` item, but
    // only once the turn has actually started, and waiting for that makes the composer feel dead.
    const messageId = randomUUID();
    emit({ type: "message.start", id: messageId, role: "user", ts: Date.now() });
    images.forEach((image, i) => {
      const id = `${messageId}:img${i}`;
      emit({ type: "block.start", messageId, block: { kind: "image", id, ...image } });
      emit({ type: "block.end", messageId, blockId: id });
    });
    if (sent) {
      emit({ type: "block.start", messageId, block: { kind: "text", id: `${messageId}:0`, text: sent } });
      emit({ type: "block.end", messageId, blockId: `${messageId}:0` });
    }
    emit({ type: "message.end", id: messageId });
    setState("running");

    const epoch = interruptEpoch;
    const input = textInput(sent, images);
    void (async () => {
      await ready;
      // Snapshot the workspace BEFORE Codex is handed the turn — a baseline taken afterwards would
      // already contain the turn's own edits.
      await checkpoints.beforeTurn(sent).catch(() => {});
      // Stopped while the snapshot was being taken: the turn was cancelled before it ever ran.
      if (stopped || interruptEpoch !== epoch || !server || !threadId) return;
      const effort = codexEffort(config.effort);
      try {
        if (currentTurnId) {
          // A turn is already in flight. Codex steers it rather than queueing a second one, which is
          // what makes "type again while it works" land in the same conversation.
          await server.request(CODEX_METHOD.turnSteer, {
            threadId, expectedTurnId: currentTurnId, input,
          });
          return;
        }
        await server.request(CODEX_METHOD.turnStart, {
          threadId,
          input,
          ...(config.model ? { model: config.model } : {}),
          ...(effort ? { effort } : {}),
          approvalPolicy: codexPermissions(config.permissionMode).approvalPolicy,
        });
      } catch (err) {
        if (stopped || interruptEpoch !== epoch) return;
        setState("idle");
        fail(err, "Codex refused the message");
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // The GuiSession surface
  // ---------------------------------------------------------------------------

  return {
    terminalId: opts.terminalId,
    state: () => state,
    sessionId: () => threadId,
    history: wholeConversation,

    subscribe(fn) {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },

    prompt: sendPrompt,

    async interrupt() {
      if (stopped) return;
      // Anything still on its way INTO the run counts as stopped too — a prompt waiting on its
      // workspace snapshot must not start a turn a moment after the button was pressed.
      interruptEpoch += 1;
      const epoch = interruptEpoch;
      const turnId = currentTurnId;
      if (server && threadId && turnId) {
        try { await server.request(CODEX_METHOD.turnInterrupt, { threadId, turnId }); }
        catch { /* the turn already ended, or the server is gone */ }
      }
      // Deny anything blocking the agent: an approval still on screen would hold the turn open.
      for (const [id, p] of approvals) { emit({ type: "approval.resolved", id, decision: "deny" }); p.resolve("decline"); }
      approvals.clear();
      for (const [, p] of questions) p.resolve({});
      questions.clear();
      if (currentTurnId) {
        emitAll(normalizer.settleOpenTools("aborted"));
        emitAll(normalizer.closeMessage());
        emit({ type: "turn.end", turnId: currentTurnId, status: "interrupted" });
        currentTurnId = null;
      }
      setState("idle");

      // Asking is not the same as stopping. A turn that is still open after the grace period means
      // Codex ignored us, so the run is torn down and the thread resumed in a fresh one.
      setTimeout(() => {
        if (stopped || interruptEpoch !== epoch || !currentTurnId) return;
        emit({ type: "notice", message: "Codex didn't stop on request — its run was ended." });
        void restart("Stopped.").catch(() => {});
      }, HARD_STOP_GRACE_MS);
    },

    pending() {
      return [
        ...(currentTurnId ? [{ type: "turn.start", turnId: currentTurnId, startedAt: turnStartedAt } as GuiEvent] : []),
        ...[...questions.values()].map((p): GuiEvent => ({ type: "question.request", request: p.request })),
        ...[...approvals.values()].map((p): GuiEvent => ({ type: "approval.request", request: p.request })),
      ];
    },

    async rewind(target) {
      if (state === "running" || state === "waiting") {
        return { ok: false as const, error: "Codex is working — stop it first." };
      }
      await ready;
      if (!server || !threadId) return { ok: false as const, error: "Codex isn't running." };

      const total = await humanTurns();
      // `userTurnsAfter` counts the human turns that FOLLOW the target, so the target plus those is
      // what has to go. Codex drops turns off the end by count — its turn is one exchange, which is
      // the same unit the chat counts.
      const drop = target.userTurnsAfter + 1;
      if (drop > total) return { ok: false as const, error: "That message is no longer in this conversation." };
      const turnIndex = total - drop;

      // Files first, and only when asked: dropping a message is not the same request as throwing
      // away the code it produced. Codex's own rollback explicitly leaves the tree alone.
      if (target.restoreFiles) {
        const snapshot = await checkpoints.restore(turnIndex, target.text);
        emit({
          type: "notice",
          message: snapshot.ok
            ? `Reverted ${snapshot.stat.files} file${snapshot.stat.files === 1 ? "" : "s"} (+${snapshot.stat.insertions}/-${snapshot.stat.deletions})${snapshot.stat.removed ? `, ${snapshot.stat.removed} new file${snapshot.stat.removed === 1 ? "" : "s"} deleted` : ""}.`
            : `Could not undo file changes: ${snapshot.reason}.`,
        });
      }

      try {
        await server.request(CODEX_METHOD.threadRollback, { threadId, numTurns: drop });
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "Codex refused the rewind." };
      }

      await checkpoints.cutTo(turnIndex);
      // Rebuild the chat from what survives. The rollback response carries the remaining turns, but
      // replaying them would re-stamp every message; cutting the copy we already hold is exact.
      const cut = truncateAtUserTurn(await wholeConversation(), target.userTurnsAfter);
      // `cut` is the whole surviving conversation, and history.reset makes the transcript hold all
      // of it — leaving the seeded prefix in place would replay those turns twice on the next connect.
      prefix = [];
      priorTurns = cut.filter((m) => m.role === "user").length;
      emit({ type: "history.reset", messages: cut });

      const next = target.newText?.trim();
      if (next) sendPrompt(next);
      return { ok: true as const };
    },

    async previewRewind(target) {
      const unknown = (reason: string): GuiRewindPreview => ({
        userTurnsAfter: target.userTurnsAfter, available: false,
        files: 0, insertions: 0, deletions: 0, removed: 0, reason,
      });
      await ready;
      const total = await humanTurns();
      const drop = target.userTurnsAfter + 1;
      if (drop > total) return unknown("that message is no longer in this conversation");
      const snapshot = await checkpoints.preview(total - drop, target.text);
      if (!snapshot.ok) return unknown(snapshot.reason);
      return { userTurnsAfter: target.userTurnsAfter, available: true, ...snapshot.stat };
    },

    resolveApproval(id, decision) {
      const pending = approvals.get(id);
      if (!pending) return;
      approvals.delete(id);
      emit({ type: "approval.resolved", id, decision });
      pending.resolve(approvalDecision(decision));
    },

    resolveQuestion(id, answers) {
      const pending = questions.get(id);
      if (!pending) return;
      questions.delete(id);
      pending.resolve(answers);
    },

    async contextUsage() { return usage; },

    async commands() {
      if (commands.length) return commands;
      await ready;
      if (!server) return [];
      commands = await listSkills(server, opts.cwd);
      return commands;
    },

    async models() {
      if (models.length) return models;
      await ready;
      if (!server) return [];
      try {
        const list = await server.request<CodexModelListResponse>(CODEX_METHOD.modelList, {});
        models = toGuiModels(list?.data ?? []);
      } catch { return []; }
      return models;
    },

    config: () => config,

    async setConfig(next) {
      const prev = config;
      if (prev.model === next.model && prev.effort === next.effort
        && prev.permissionMode === next.permissionMode) return prev;
      config = next;
      // Model, effort and the approval policy all ride on the next `turn/start`, so they need no
      // handshake. The sandbox is fixed when the thread is opened, so changing it means reopening —
      // the conversation carries over by id, and the chat sees a config change, not a lost chat.
      if (codexPermissions(prev.permissionMode).sandbox !== codexPermissions(next.permissionMode).sandbox) {
        try { await restart("Applying the new permissions."); }
        catch (err) { config = prev; fail(err, "could not apply the new settings"); }
      }
      emit({ type: "config", config });
      return config;
    },

    async stop() {
      if (stopped) return;
      stopped = true;
      for (const [, p] of approvals) p.resolve("decline");
      approvals.clear();
      for (const [, p] of questions) p.resolve({});
      questions.clear();
      const app = server;
      server = null;
      await app?.close();
      setState("stopped");
      subscribers.clear();
    },
  };
}

/** Everything up to and including the user turn that has `userTurnsAfter` human turns after it is
 *  what a rewind KEEPS the front half of — the target turn and all of its consequences go. */
function truncateAtUserTurn(messages: GuiMessage[], userTurnsAfter: number): GuiMessage[] {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue;
    if (seen === userTurnsAfter) return messages.slice(0, i);
    seen += 1;
  }
  return [];
}
