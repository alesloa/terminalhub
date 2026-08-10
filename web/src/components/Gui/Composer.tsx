import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { GuiCommand, GuiConfig, GuiContextUsage, GuiImageAttachment, GuiModel } from "../../api/guiTypes";
import { findModel, hasReasoningOptions } from "./composerOptions";
import { ModelPill } from "./ModelPill";
import { PermissionPill } from "./PermissionPill";
import { ReasoningPill } from "./ReasoningPill";
import { ContextMeter } from "./ContextMeter";
import { MentionMenu, type MentionItem } from "./MentionMenu";
import { applyMention, mentionAt, rankPaths } from "./composerMentions";
import { useAttachments } from "./useAttachments";

const MAX_HEIGHT_PX = 160;
const MAX_MENTION_ROWS = 10;
const NO_MODELS: GuiModel[] = [];   // stable identity, so a pending fetch doesn't churn the pills
const NO_COMMANDS: GuiCommand[] = [];
const NO_FILES: string[] = [];

interface Props {
  terminalId: string;
  /** Workspace folder — the root the @file menu lists from. */
  folder: string;
  busy: boolean;
  connected: boolean;
  /** null until the socket has told us what the session is actually configured with. */
  config: GuiConfig | null;
  /** Empty transcript: the composer sits under the hero instead of pinned to the bottom edge. */
  hero: boolean;
  contextUsage: GuiContextUsage | null;
  costUsd: number | null;
  onSend: (text: string, images?: GuiImageAttachment[]) => void;
  onInterrupt: () => void;
  onConfig: (patch: Partial<GuiConfig>) => void;
}

/** Prompt box: Enter sends, Shift+Enter inserts a newline, and the send button becomes a stop button
 *  for as long as a turn is running. Below the text sits the control row — model, reasoning, and
 *  permissions — so what the next turn will run with is visible without opening a settings panel.
 *
 *  Typing `@` opens a file picker for the workspace, `/` at the start opens the CLI's own slash
 *  commands, and images can be pasted or dropped straight in. */
export function Composer({
  terminalId, folder, busy, connected, config, hero, contextUsage, costUsd, onSend, onInterrupt, onConfig,
}: Props) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments();

  // The catalog is whatever the installed CLI reports, so it can't shift under a live session — fetch
  // it once per terminal and hold it. Keyed by terminal because it's a per-session question.
  const { data } = useQuery({
    queryKey: ["gui", "models", terminalId],
    queryFn: () => api.guiModels(terminalId),
    staleTime: Infinity,
    // The server answers with an empty list until the agent child is up and its control channel
    // responds. Without this, one unlucky first fetch would cache "no models" for the life of the
    // panel and the picker would never populate.
    refetchInterval: (q) => (q.state.data?.models.length ? false : 2000),
  });
  const models = data?.models ?? NO_MODELS;

  const mention = menuOpen ? mentionAt(text, caret) : null;

  // Both lists are only fetched once their trigger has actually been typed: a repo file list is not
  // cheap, and most messages never open either menu.
  const { data: commandData } = useQuery({
    queryKey: ["gui", "commands", terminalId],
    queryFn: () => api.guiCommands(terminalId),
    enabled: mention?.kind === "command",
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.commands.length ? false : 2000),
  });
  const { data: fileData } = useQuery({
    queryKey: ["fs", "files", folder],
    queryFn: () => api.fsFiles(folder),
    enabled: mention?.kind === "file" && Boolean(folder),
    staleTime: 60_000,
  });

  const commands = commandData?.commands ?? NO_COMMANDS;
  const files = fileData?.files ?? NO_FILES;

  const items = useMemo<MentionItem[]>(() => {
    if (!mention) return [];
    if (mention.kind === "command") {
      return commands
        .filter((c) => c.name.toLowerCase().includes(mention.query))
        .slice(0, MAX_MENTION_ROWS)
        .map((c) => ({ value: `/${c.name}`, hint: c.argumentHint ? `${c.argumentHint} — ${c.description}` : c.description }));
    }
    return rankPaths(files, mention.query, MAX_MENTION_ROWS).map((path) => {
      const cut = path.lastIndexOf("/");
      return { value: `@${path}`, hint: cut > 0 ? path.slice(0, cut) : undefined };
    });
  }, [mention, commands, files]);

  const active = items.length ? Math.min(menuIndex, items.length - 1) : 0;

  // Grow the box with its content up to a cap. Height has to be zeroed first or scrollHeight only
  // ever reports the current (already-grown) height and the box can never shrink back.
  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  };

  const write = (next: string, nextCaret: number) => {
    setText(next);
    setCaret(nextCaret);
    setMenuIndex(0);
    setMenuOpen(true);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) { el.setSelectionRange(nextCaret, nextCaret); el.focus(); }
      grow();
    });
  };

  const pick = (value: string) => {
    if (!mention) return;
    const next = applyMention(text, mention, caret, value);
    write(next.text, next.caret);
  };

  const submit = () => {
    const value = text.trim();
    if ((!value && !attachments.images.length) || busy || !connected) return;
    const images: GuiImageAttachment[] = attachments.images.map(({ mediaType, dataBase64 }) => ({ mediaType, dataBase64 }));
    setText("");
    setCaret(0);
    attachments.clear();
    onSend(value, images.length ? images : undefined);
    requestAnimationFrame(grow); // after the cleared value has been painted
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // The menu owns the arrows, Tab, Enter and Escape while it's open — otherwise Enter would send
    // the half-typed mention instead of completing it.
    if (mention && items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenuIndex((i) => (i + 1) % items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenuIndex((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        pick(items[active].value);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setMenuOpen(false); return; }
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    // Leave IME composition alone — Enter is how you accept a candidate, not how you send.
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  };

  const syncCaret = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCaret(e.currentTarget.selectionStart ?? 0);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault(); // otherwise the file name is pasted as text alongside the attachment
    void attachments.add(files);
  };

  // Stable so the model pill's ⌘1…⌘9 listener isn't torn down and rebuilt on every keystroke here.
  const pickModel = useCallback((value: string) => onConfig({ model: value }), [onConfig]);

  const selectedModel = findModel(models, config?.model ?? null);
  const canSend = Boolean(text.trim() || attachments.images.length);

  return (
    <div className={`shrink-0 p-3 ${hero ? "" : "border-t border-edge"}`}>
      <div className={hero ? "mx-auto w-full max-w-2xl" : ""}>
        {mention && <MentionMenu items={items} active={active} onPick={pick} />}

        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            const dropped = Array.from(e.dataTransfer?.files ?? []);
            if (!dropped.length) return;
            e.preventDefault();
            setDragging(false);
            void attachments.add(dropped);
          }}
          className={`rounded-xl border bg-panel px-3 py-2 transition-colors focus-within:border-accent/60 ${
            dragging ? "border-accent" : "border-edge"
          }`}
        >
          {attachments.images.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {attachments.images.map((img) => (
                <span key={img.id} className="group/att relative">
                  <img src={img.url} alt="" className="h-14 w-14 rounded-md border border-edge object-cover" />
                  <button
                    type="button"
                    onClick={() => attachments.remove(img.id)}
                    aria-label="Remove attachment"
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-elevated text-[10px] text-muted opacity-0 shadow transition-opacity group-hover/att:opacity-100 hover:text-bright"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {attachments.error && (
            <button
              type="button"
              onClick={attachments.dismissError}
              className="mb-1 block w-full text-left text-[11px] text-error"
            >
              {attachments.error} — click to dismiss
            </button>
          )}

          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? 0); setMenuIndex(0); setMenuOpen(true); grow(); }}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setMenuOpen(false)}
            onFocus={() => setMenuOpen(true)}
            placeholder={connected ? "Message Claude…  (@ for files, / for commands, paste an image)" : "Not connected"}
            className="block max-h-40 w-full resize-none bg-transparent py-1 text-sm leading-6 outline-none placeholder:text-dim"
          />

          {/* Wraps rather than overflowing: at a narrow dock width the pills stack onto extra rows and
              the send button rides the last one. */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {config && models.length > 0 && (
              <ModelPill models={models} model={config.model} onPick={pickModel} />
            )}
            {config && selectedModel && hasReasoningOptions(selectedModel) && (
              <ReasoningPill model={selectedModel} config={config} onPatch={onConfig} />
            )}
            {config && <PermissionPill config={config} onPatch={onConfig} />}

            <span className="ml-auto flex items-center gap-2">
              <ContextMeter usage={contextUsage} costUsd={costUsd} />
              {busy ? (
                <button
                  type="button"
                  onClick={onInterrupt}
                  title="Stop"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-error text-white transition-colors hover:opacity-90"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend || !connected}
                  title="Send"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent"
                >
                  <SendIcon />
                </button>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const SendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

const StopIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </svg>
);
