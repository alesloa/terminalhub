import { useState, type FormEvent } from "react";
import type { Link, LinkFolder } from "../../api/types";

export type LinkDraft = { title: string; url: string; description: string; folderId: string | null };

/** Add / edit form for a saved web link. URL is required; everything else is optional (the dropdown
 *  falls back to the hostname when the title is blank). Folder picks an existing folder or "No folder".
 *  Reused for both create (no `initial`) and edit (initial = the link being changed). */
export function LinkForm({ initial, folders, defaultFolderId, onSave, onCancel }: {
  initial?: Link;
  folders: LinkFolder[];
  defaultFolderId?: string | null;
  onSave: (v: LinkDraft) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [folderId, setFolderId] = useState<string | null>(initial?.folderId ?? defaultFolderId ?? null);
  const canSave = url.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave({ title: title.trim(), url: url.trim(), description: description.trim(), folderId });
  };

  const field = "mt-1 w-full rounded-md border border-edge bg-canvas px-2 py-1.5 text-[13px] text-fg outline-none focus:border-edge-strong placeholder:text-dim";
  const label = "block text-[11px] font-medium uppercase tracking-wide text-dim";

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 px-3 py-3">
      <label>
        <span className={label}>URL</span>
        <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" className={field} />
      </label>
      <label>
        <span className={label}>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="(defaults to the site name)" className={field} />
      </label>
      <label>
        <span className={label}>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this site is for" className={`${field} resize-none`} />
      </label>
      <label>
        <span className={label}>Folder</span>
        <select value={folderId ?? ""} onChange={(e) => setFolderId(e.target.value || null)} className={`${field} cursor-pointer`}>
          <option value="">No folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name || "Untitled folder"}</option>)}
        </select>
      </label>
      <div className="mt-0.5 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[13px] text-dim hover:text-fg">Cancel</button>
        <button type="submit" disabled={!canSave}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">
          {initial ? "Save" : "Add link"}
        </button>
      </div>
    </form>
  );
}
