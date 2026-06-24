/**
 * Local draft backup for the File Browser editor — VS Code "hot exit" style. When an editor window
 * goes away WITHOUT an explicit Save / Don't-Save decision (the whole File Browser is closed, the tab
 * is refreshed, the process dies), the unsaved buffer is stashed here keyed by the file's ref, and
 * restored — still marked dirty — the next time that file is opened.
 *
 * This NEVER writes to disk: the draft lives only in the browser, and the user still has to Save to
 * persist it. Cleared on an explicit Save (it's on disk now) or Don't Save (they discarded it). So a
 * dropped/refreshed window picks up exactly where it left off, but nothing is written behind the
 * user's back.
 */
const PREFIX = "tr.editorDraft:";
const keyFor = (refKey: string) => PREFIX + refKey;

export function saveDraft(refKey: string, content: string) {
  try { localStorage.setItem(keyFor(refKey), content); } catch { /* quota/blocked — best-effort */ }
}

export function loadDraft(refKey: string): string | null {
  try { return localStorage.getItem(keyFor(refKey)); } catch { return null; }
}

export function clearDraft(refKey: string) {
  try { localStorage.removeItem(keyFor(refKey)); } catch { /* ignore */ }
}
