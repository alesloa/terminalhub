import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type TransitionEventHandler } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Workspace } from "../api/types";
import type { WinRect } from "../store/ui";
import { spacesBarBottom } from "../store/ui";
import { useDraggableWindow, type WindowHandle } from "../hooks/useDraggableWindow";
import { ResizeHandles } from "./ResizeHandles";
import { DictationButton } from "./DictationButton";

const MIN_W = 420, MIN_H = 300;
const DURATION = 300; // ms — grow-from-icon / minimize-to-icon animation

/** A compact panel centered and clamped below the spaces bar. */
function defaultRect(): WinRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(560, Math.max(MIN_W, Math.round(vw * 0.4)));
  const h = Math.min(440, Math.max(MIN_H, Math.round(vh * 0.55)));
  const top = spacesBarBottom() + 8;
  return { w, h, x: Math.max(8, Math.round((vw - w) / 2)), y: Math.max(top, Math.round((vh - h) / 2)) };
}

/**
 * Per-workspace system prompt editor — a free-floating, draggable, resizable window (NOT a modal: it
 * never dims the room) that grows out of the room header's cog and minimizes back into it on close.
 * Edits `workspace.systemPrompt` ({ text, includeGlobal }) over REST. This layer sits between the
 * agent's GLOBAL prompt (Settings → Agent Prompts) and the one-off per-terminal message in the New
 * Terminal flow: at launch the effective prompt is global ⊕ workspace ⊕ terminal, and "Build on the
 * global prompt" toggles whether this workspace appends to (on) or replaces (off) the global layer.
 * See server agents/systemPrompt.ts (resolveEffective).
 */
export const WorkspacePromptWindow = forwardRef<WindowHandle, {
  workspaceId: string;
  workspaceName: string;
  origin?: WinRect | null;
  onClose: () => void;
}>(function WorkspacePromptWindow({ workspaceId, workspaceName, origin, onClose }, ref) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["workspaces"], queryFn: api.listWorkspaces });
  const ws = data?.workspaces.find((w) => w.id === workspaceId);

  // Draft state, seeded from the workspace's stored prompt; re-seeded when the stored value changes
  // and we're not mid-edit (dirty), so a background refetch doesn't clobber what the user is typing.
  const [text, setText] = useState("");
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [dirty, setDirty] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (dirty || !ws) return;
    setText(ws.systemPrompt?.text ?? "");
    setIncludeGlobal(ws.systemPrompt?.includeGlobal ?? true);
  }, [ws, dirty]);

  const save = useMutation({
    mutationFn: () => {
      const trimmed = text.trim();
      const systemPrompt = trimmed ? { text: trimmed, includeGlobal } : null;
      return api.updateWorkspace(workspaceId, { systemPrompt });
    },
    onSuccess: ({ workspace: updated }) => {
      setDirty(false);
      qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) =>
        old ? { workspaces: old.workspaces.map((w) => (w.id === updated.id ? updated : w)) } : old);
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  const [seed] = useState(defaultRect);
  const { rect, beginDrag, beginResize } = useDraggableWindow(seed, MIN_W, MIN_H);

  // Grow-from-icon on open, minimize-to-icon on close — same trick as the room↔card animation.
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [expanded, setExpanded] = useState(reduce);
  useEffect(() => {
    if (reduce) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [reduce]);
  const handleClose = () => { if (reduce) { onClose(); return; } setExpanded(false); };
  useImperativeHandle(ref, () => ({ close: handleClose }));
  const onTransitionEnd: TransitionEventHandler = (e) => {
    if (e.target === e.currentTarget && e.propertyName === "transform" && !expanded) onClose();
  };

  // Drop dictated speech at the textarea caret (or append if it's not focused).
  const insertText = (t: string) => {
    const el = textRef.current;
    setDirty(true);
    if (!el) { setText((cur) => (cur ? `${cur} ${t}` : t)); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setText((cur) => cur.slice(0, start) + t + cur.slice(end));
    requestAnimationFrame(() => { el.focus(); const pos = start + t.length; el.setSelectionRange(pos, pos); });
  };

  const collapsed = origin
    ? `translate(${origin.x - rect.x}px, ${origin.y - rect.y}px) scale(${origin.w / rect.w}, ${origin.h / rect.h})`
    : "scale(0.94)";
  const style: CSSProperties = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    ...(reduce ? {} : {
      transformOrigin: origin ? "0 0" : "50% 50%",
      transform: expanded ? "translate(0px, 0px) scale(1, 1)" : collapsed,
      opacity: expanded ? 1 : 0,
      transition: `transform ${DURATION}ms cubic-bezier(.22,.61,.36,1), opacity ${DURATION}ms ease`,
      willChange: "transform, opacity",
    }),
  };

  return (
    <div onTransitionEnd={onTransitionEnd} style={style}
      className="fixed z-50 flex flex-col rounded-lg overflow-hidden border border-edge-strong bg-canvas shadow-2xl">
      {/* Title bar = drag handle. The control cluster swallows pointer-down so clicking it never drags. */}
      <div onPointerDown={beginDrag}
        className="h-8 shrink-0 flex items-center justify-between gap-3 px-4 border-b border-edge cursor-move select-none">
        <div className="min-w-0">
          <span className="font-semibold">System message</span>
          <span className="ml-2 text-xs text-dim truncate">{workspaceName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <DictationButton onText={insertText} enabled disabledTitle="" />
          <button onClick={handleClose} title="Close" className="px-3 h-6 inline-flex items-center bg-elevated rounded text-sm">Close</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-3 p-4">
        <p className="text-xs text-dim">
          Prepended to every agent launched in this workspace, on top of the agent's global system prompt
          (Settings → Agent Prompts). Each New Terminal can still layer a one-off message on top.
        </p>

        <textarea
          ref={textRef}
          value={text}
          onChange={(e) => { setDirty(true); setText(e.target.value); }}
          placeholder={`System prompt for every agent in ${workspaceName}…`}
          className="flex-1 min-h-0 w-full resize-none rounded border border-edge bg-canvas px-3 py-2 text-sm text-bright outline-none focus:border-blue-500"
        />

        <label className="flex items-start gap-2 text-sm text-fg cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeGlobal}
            onChange={(e) => { setDirty(true); setIncludeGlobal(e.target.checked); }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
          />
          <span>
            Build on the agent's global prompt
            <span className="block text-xs text-dim">Off: this message replaces the global prompt for this workspace.</span>
          </span>
        </label>

        <div className="flex items-center justify-end gap-2">
          {save.isError && <span className="text-xs text-error">Couldn't save</span>}
          {save.isSuccess && !dirty && <span className="text-xs text-dim">Saved</span>}
          <button
            disabled={!dirty || save.isPending || !ws}
            onClick={() => save.mutate()}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <ResizeHandles onStart={beginResize} />
    </div>
  );
});
