import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FolderPicker } from "./FolderPicker";
import { GithubRepoPicker } from "./GithubRepoPicker";
import { api } from "../api/client";
import type { GithubRepo, GithubAccount } from "../api/types";

type Check = "idle" | "checking" | "ok" | "bad";
type Mode = "local" | "clone";
type Source = "url" | "github";

/** Default folder/workspace name from a git url: last path segment, minus a trailing `.git`. */
function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  return cleaned.split(/[/:]/).filter(Boolean).pop() ?? "";
}

/** A clone folder name must be a single path segment (no separators, not "."/".."). */
function validCloneName(name: string): boolean {
  return /^[^/\\]+$/.test(name) && name !== "." && name !== "..";
}

const INPUT =
  "w-full px-3 py-2 bg-surface border border-edge rounded-lg text-sm text-fg placeholder:text-dim " +
  "outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/40";

export function NewWorkspaceModal({ onCreate, onClone, onCancel }: {
  onCreate: (v: { name: string; folder: string }) => void;
  // Clone mode hands off to an async server-side job: the parent starts it (fast POST), drops a
  // placeholder card on the canvas, and closes this modal — the download itself never blocks the UI.
  // Rejections (target exists, bad url) surface back here as the inline error.
  onClone: (v: { name: string; parent: string; url?: string; repo?: string; account?: string; host?: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<Mode>("local");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  // local mode: an existing folder. clone mode: the PARENT folder the repo is cloned into.
  const [folder, setFolder] = useState("");
  const [parent, setParent] = useState("");
  // clone mode source: paste a url, or pick from the user's GitHub.
  const [source, setSource] = useState<Source>("url");
  const [url, setUrl] = useState("");
  const [ghRepo, setGhRepo] = useState<string | null>(null); // nameWithOwner when picked from GitHub
  const [ghAccount, setGhAccount] = useState<GithubAccount | null>(null); // which gh account it was browsed under
  const [picking, setPicking] = useState(false);
  const [check, setCheck] = useState<Check>("idle");
  const [resolved, setResolved] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [shown, setShown] = useState(false); // drives the grow-in entrance

  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  // Escape closes the wizard (but not while the folder picker overlay is up — it has its own Cancel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !picking) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, onCancel]);

  // Validate the active path field (the local folder, or the clone PARENT) against the host fs
  // (debounced). A successful listing means it exists and is a readable directory; reuse its
  // canonical `path` so trailing slashes / `..` are normalized. In local mode, default the name
  // from the folder's basename.
  const pathValue = mode === "local" ? folder : parent;
  useEffect(() => {
    const path = pathValue.trim();
    if (!path) { setCheck("idle"); setResolved(""); return; }
    setCheck("checking");
    let cancelled = false;
    const t = setTimeout(() => {
      api.fsList(path)
        .then(r => {
          if (cancelled) return;
          setResolved(r.path);
          setCheck("ok");
          if (mode === "local" && !nameTouched) setName(r.path.split("/").pop() ?? "workspace");
        })
        .catch(() => { if (!cancelled) { setCheck("bad"); setResolved(""); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [pathValue, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const onUrlChange = (v: string) => {
    setUrl(v);
    if (!nameTouched) { const d = repoNameFromUrl(v); if (d) setName(d); }
  };
  const onPickRepo = (r: GithubRepo, account: GithubAccount) => {
    setGhRepo(r.nameWithOwner);
    setGhAccount(account);
    if (!nameTouched) setName(r.name);
  };

  const hasSource = source === "url" ? !!url.trim() : !!ghRepo;
  const canCreate = mode === "local"
    ? !!name && check === "ok"
    : check === "ok" && validCloneName(name) && hasSource && !cloning;

  const submit = () => {
    if (!canCreate) return;
    if (mode === "local") { onCreate({ name, folder: resolved }); return; }
    setCloning(true);
    setCloneError(null);
    // Only the job START is awaited (a fast validation round-trip) — the parent closes the modal on
    // success and the clone continues as a canvas card. Failures come straight back inline.
    const v = source === "github" && ghRepo
      ? { name, parent: resolved, repo: ghRepo, account: ghAccount?.login, host: ghAccount?.host }
      : { name, parent: resolved, url: url.trim() };
    onClone(v).catch(e => { setCloneError(String(e.message)); setCloning(false); });
  };
  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
  };

  const pathField = mode === "local" ? folder : parent;
  const setPath = mode === "local" ? setFolder : setParent;

  return (
    <>
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none ${shown ? "opacity-100" : "opacity-0"}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog" aria-modal="true" aria-labelledby="nw-title"
    >
      <div
        className={`w-[460px] max-w-[calc(100vw-2rem)] bg-panel border border-edge-strong rounded-2xl shadow-2xl overflow-hidden origin-center transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${shown ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
      >
        {/* header */}
        <div className="flex items-start gap-3 px-6 pt-6 pb-4">
          <div className="h-9 w-9 shrink-0 grid place-items-center rounded-lg bg-blue-600/15 text-blue-400">
            <NewWorkspaceIcon />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="nw-title" className="text-base font-semibold text-bright leading-tight">New workspace</h2>
            <p className="text-xs text-muted mt-0.5">Open a folder, or clone a repo into one.</p>
          </div>
          <button onClick={onCancel} aria-label="Close"
            className="shrink-0 -mr-1.5 -mt-1.5 h-8 w-8 grid place-items-center rounded-lg text-dim hover:text-fg hover:bg-surface transition-colors cursor-pointer">
            <CloseIcon />
          </button>
        </div>

        {/* body */}
        <div className="px-6 pb-5 flex flex-col gap-4">
          {/* mode segmented control */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-canvas border border-edge rounded-xl">
            <SegTab active={mode === "local"} onClick={() => { setMode("local"); setCheck("idle"); setResolved(""); setCloneError(null); }} icon={<FolderIcon />}>Local folder</SegTab>
            <SegTab active={mode === "clone"} onClick={() => { setMode("clone"); setCheck("idle"); setResolved(""); setCloneError(null); }} icon={<GitBranchIcon />}>Clone repo</SegTab>
          </div>

          {/* clone source */}
          {mode === "clone" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">Repository</span>
                <div className="flex gap-1 p-0.5 bg-canvas border border-edge rounded-lg">
                  <SubTab active={source === "url"} onClick={() => { setSource("url"); setCloneError(null); setGhRepo(null); setGhAccount(null); }} icon={<LinkIcon />}>Paste URL</SubTab>
                  <SubTab active={source === "github"} onClick={() => { setSource("github"); setCloneError(null); setUrl(""); }} icon={<GithubIcon />}>My GitHub</SubTab>
                </div>
              </div>
              {source === "url"
                ? <input value={url} onChange={e => onUrlChange(e.target.value)} onKeyDown={onFieldKey}
                    placeholder="https://github.com/user/repo.git" spellCheck={false} autoComplete="off"
                    className={`${INPUT} font-mono`} aria-label="Repository URL" />
                : <GithubRepoPicker selected={ghRepo} onPick={onPickRepo} />}
            </div>
          )}

          {/* name */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nw-name" className="text-xs font-medium text-muted">Name</label>
            <input id="nw-name" value={name} autoFocus onKeyDown={onFieldKey}
              onChange={e => { setName(e.target.value); setNameTouched(true); }}
              placeholder="my-project" className={INPUT} />
          </div>

          {/* folder / clone-into */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nw-folder" className="text-xs font-medium text-muted">{mode === "local" ? "Folder" : "Clone into"}</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim"><FolderIcon /></span>
                <input id="nw-folder" value={pathField} onChange={e => setPath(e.target.value)} onKeyDown={onFieldKey}
                  placeholder="paste a path or pick a folder…" spellCheck={false} autoComplete="off"
                  className={`${INPUT} pl-9 font-mono`} />
              </div>
              <button onClick={() => setPicking(true)}
                className="shrink-0 px-3 bg-elevated border border-edge rounded-lg text-sm text-fg hover:bg-edge-strong transition-colors cursor-pointer">
                Browse
              </button>
            </div>
            {check === "checking" && <Hint><SpinnerIcon /> checking…</Hint>}
            {check === "bad" && <Hint tone="error"><AlertIcon /> not a readable directory</Hint>}
            {check === "ok" && mode === "local" && <Hint tone="ok"><CheckIcon /> <span className="truncate">{resolved}</span></Hint>}
            {check === "ok" && mode === "clone" && validCloneName(name) &&
              <Hint tone="ok"><CheckIcon /> <span className="truncate">clones to <span className="font-mono">{resolved}/{name}</span></span></Hint>}
          </div>

          {cloneError && (
            <div className="flex items-start gap-2 px-3 py-2 bg-error/10 border border-error/30 rounded-lg text-xs text-error">
              <span className="mt-0.5 shrink-0"><AlertIcon /></span>
              <span className="whitespace-pre-wrap break-words">{cloneError}</span>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-edge bg-surface/30">
          <button onClick={onCancel}
            className="px-3.5 py-2 rounded-lg text-sm text-muted hover:text-fg hover:bg-surface transition-colors cursor-pointer">
            Cancel
          </button>
          <button disabled={!canCreate} onClick={submit}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            {cloning && <SpinnerIcon />}
            {mode === "clone" ? (cloning ? "Cloning…" : "Clone & Create") : "Create"}
          </button>
        </div>
      </div>
    </div>

    {/* The folder picker is an overlay ON TOP of the wizard, not a replacement — so the GitHub repo
        picker (and its selected account, filter, and scroll position) stays mounted underneath
        instead of remounting and resetting to the default account when a folder is picked. */}
    {picking && (
      <FolderPicker
        onPick={(p) => { (mode === "local" ? setFolder : setParent)(p); setPicking(false); }}
        onCancel={() => setPicking(false)}
      />
    )}
    </>
  );
}

/* ---- small pieces ---- */

function SegTab({ active, onClick, icon, children }:
  { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${active ? "bg-elevated text-bright shadow-sm" : "text-muted hover:text-fg"}`}>
      <span className={active ? "text-blue-400" : ""}>{icon}</span>{children}
    </button>
  );
}

function SubTab({ active, onClick, icon, children }:
  { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer ${active ? "bg-elevated text-bright" : "text-muted hover:text-fg"}`}>
      {icon}{children}
    </button>
  );
}

function Hint({ tone = "muted", children }: { tone?: "muted" | "ok" | "error"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "text-blue-400" : tone === "error" ? "text-error" : "text-muted";
  return <div className={`flex items-center gap-1.5 text-xs min-w-0 ${cls}`}>{children}</div>;
}

/* ---- icons (inline SVG, matching the app's TopBar icon convention) ---- */

const sv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

function NewWorkspaceIcon() {
  return (
    <svg width="18" height="18" {...sv}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </svg>
  );
}
function FolderIcon() {
  return <svg width="15" height="15" {...sv}><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z" /></svg>;
}
function GitBranchIcon() {
  return (
    <svg width="15" height="15" {...sv}>
      <circle cx="6" cy="6" r="2.2" /><circle cx="6" cy="18" r="2.2" /><circle cx="18" cy="7.5" r="2.2" />
      <path d="M6 8.2v7.6M18 9.7c0 3.5-2.8 4.3-6 4.3" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg width="14" height="14" {...sv}>
      <path d="M9.5 13.5 14.5 8.5" />
      <path d="M11 6.5l1-1a3.2 3.2 0 0 1 4.5 4.5l-1 1" />
      <path d="M13 17.5l-1 1A3.2 3.2 0 0 1 7.5 14l1-1" />
    </svg>
  );
}
function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}
function CheckIcon() {
  return <svg width="14" height="14" className="shrink-0" {...sv}><path d="m5 12.5 4.5 4.5L19 7" /></svg>;
}
function AlertIcon() {
  return <svg width="14" height="14" className="shrink-0" {...sv}><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" /></svg>;
}
function CloseIcon() {
  return <svg width="16" height="16" {...sv}><path d="M6 6l12 12M18 6 6 18" /></svg>;
}
function SpinnerIcon() {
  return (
    <svg width="14" height="14" className="shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
