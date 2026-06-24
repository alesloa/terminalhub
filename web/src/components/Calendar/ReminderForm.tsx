import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ReminderInput } from "../../api/client";
import type { Reminder, RecurrenceFreq } from "../../api/types";
import { useReminders } from "./useReminders";
import { toLocalInput, toLocalDate, fromLocalInput, fromLocalDate } from "./calendarUtils";

// Apple-style event editor. Mounts as a sheet that slides in from the right of the calendar window
// ("pops out to the side"). Drives create + edit + delete; the standalone "+ New" button opens it
// with no `initial`. Pickers run in local time → epoch ms on submit (never a naive local datetime).

const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];
const LEAD_OPTIONS: { v: number; label: string }[] = [
  { v: 0, label: "At time of event" },
  { v: 5, label: "5 minutes before" },
  { v: 15, label: "15 minutes before" },
  { v: 30, label: "30 minutes before" },
  { v: 60, label: "1 hour before" },
  { v: 120, label: "2 hours before" },
  { v: 1440, label: "1 day before" },
];
const FREQS: { v: "none" | RecurrenceFreq; label: string }[] = [
  { v: "none", label: "Does not repeat" },
  { v: "daily", label: "Daily" },
  { v: "weekly", label: "Weekly" },
  { v: "monthly", label: "Monthly" },
  { v: "yearly", label: "Yearly" },
];
const PRIORITIES: { v: number; label: string }[] = [
  { v: -1, label: "Quiet" },
  { v: 0, label: "Normal" },
  { v: 1, label: "High" },
  { v: 2, label: "Emergency" },
];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type EndsMode = "never" | "onDate" | "afterN";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function ReminderForm({ initial, defaultStart, onClose }: {
  initial?: Reminder | null;
  defaultStart?: number;        // epoch ms to prefill the start with (a clicked day/slot)
  onClose: () => void;
}) {
  const { create, update, remove } = useReminders();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const pushoverConfigured = settings?.pushoverConfigured ?? false;

  const startMs = initial?.fireAt ?? defaultStart ?? Date.now();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [start, setStart] = useState(toLocalInput(startMs));
  const [startDate, setStartDate] = useState(toLocalDate(startMs));
  const [end, setEnd] = useState(initial?.endAt != null ? toLocalInput(initial.endAt) : "");
  const [color, setColor] = useState<string | null>(initial?.color ?? null);
  const [inApp, setInApp] = useState(initial?.channels.inApp ?? true);
  const [speak, setSpeak] = useState(initial?.channels.speak ?? true);
  const [pushover, setPushover] = useState(initial?.channels.pushover ?? false);
  const [priority, setPriority] = useState(initial?.priority ?? 0);
  const [leadMinutes, setLeadMinutes] = useState(initial?.leadMinutes ?? 0);
  const [freq, setFreq] = useState<"none" | RecurrenceFreq>(initial?.recurrence?.freq ?? "none");
  const [interval, setInterval] = useState(initial?.recurrence?.interval ?? 1);
  const [endsMode, setEndsMode] = useState<EndsMode>(
    initial?.recurrence?.until != null ? "onDate" : initial?.recurrence?.count != null ? "afterN" : "never",
  );
  const [untilDate, setUntilDate] = useState(initial?.recurrence?.until != null ? toLocalDate(initial.recurrence.until) : "");
  const [count, setCount] = useState(initial?.recurrence?.count ?? 10);

  // Image: keep the existing one (edit), pick a new data URL, or clear it. `image === undefined` means
  // "leave untouched" on patch; null clears; a string sets.
  const [image, setImage] = useState<string | undefined>(undefined);
  const [removedImage, setRemovedImage] = useState(false);
  const [imgError, setImgError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const existingImage = initial?.imagePath && !removedImage && image === undefined;
  const previewSrc = image ?? (existingImage && initial ? api.reminders.imageUrl(initial.id) : null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canSave = title.trim().length > 0 && !busy;

  const recurrence = useMemo(() => {
    if (freq === "none") return null;
    return {
      freq,
      interval: Math.max(1, Math.min(365, Math.round(interval) || 1)),
      until: endsMode === "onDate" && untilDate ? fromLocalDate(untilDate) + 86_399_000 : null,
      count: endsMode === "afterN" ? Math.max(1, Math.round(count) || 1) : null,
    };
  }, [freq, interval, endsMode, untilDate, count]);

  const pickImage = async (file: File | undefined) => {
    setImgError("");
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setImgError("Image must be under 5 MB."); return; }
    try { setImage(await readFileAsDataUrl(file)); setRemovedImage(false); }
    catch { setImgError("Couldn't read that image."); }
  };
  const clearImage = () => { setImage(undefined); setRemovedImage(true); if (fileRef.current) fileRef.current.value = ""; };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true); setError("");
    const fireAt = allDay ? fromLocalDate(startDate) : fromLocalInput(start);
    const endAt = !allDay && end ? fromLocalInput(end) : null;
    const fields: ReminderInput = {
      title: title.trim(),
      fireAt,
      body: body.trim(),
      allDay,
      endAt,
      leadMinutes,
      color,
      channels: { inApp, pushover, speak },
      priority,
      recurrence,
    };
    try {
      if (initial) {
        const imagePatch = image !== undefined ? { image } : removedImage ? { image: null } : {};
        await update(initial.id, { ...fields, status: "pending", ...imagePatch });
      } else {
        await create({ ...fields, ...(image !== undefined ? { image } : {}) });
      }
      onClose();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  const del = async () => {
    if (!initial || busy) return;
    if (!confirm(`Delete "${initial.title}"?`)) return;
    setBusy(true);
    try { await remove(initial.id); onClose(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };

  return (
    <div className="absolute inset-y-0 right-0 z-10 flex w-[400px] max-w-full flex-col border-l border-edge bg-panel shadow-2xl tr-sheet-in">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-edge px-4">
        <div className="text-sm font-semibold">{initial ? "Edit event" : "New event"}</div>
        <button onClick={onClose} className="rounded bg-elevated px-2 py-1 text-xs hover:bg-edge">Close</button>
      </div>

      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4 text-sm">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title"
          className="w-full rounded border border-edge-strong bg-canvas px-3 py-2 text-bright outline-none focus:border-blue-500" />

        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(color === c ? null : c)} title={c}
              style={{ background: c }}
              className={`h-6 w-6 rounded-full transition ${color === c ? "ring-2 ring-white scale-110" : "opacity-80 hover:opacity-100"}`} />
          ))}
        </div>

        <label className="flex items-center justify-between">
          <span className="text-fg">All-day</span>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="h-4 w-4 accent-blue-500" />
        </label>

        <Field label="Starts">
          {allDay
            ? <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            : <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />}
        </Field>
        {!allDay && (
          <Field label="Ends" hint="Optional">
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </Field>
        )}

        <Field label="Notes">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Add notes…"
            className="w-full resize-none rounded border border-edge-strong bg-canvas px-3 py-2 text-fg outline-none focus:border-blue-500" />
        </Field>

        <Field label="Repeat">
          <div className="flex items-center gap-2">
            <select value={freq} onChange={(e) => setFreq(e.target.value as "none" | RecurrenceFreq)} className={selCls}>
              {FREQS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
            </select>
            {freq !== "none" && (
              <span className="flex items-center gap-1 text-xs text-dim">
                every
                <input type="number" min={1} max={365} value={interval} onChange={(e) => setInterval(Number(e.target.value))}
                  className="w-14 rounded border border-edge-strong bg-canvas px-2 py-1 text-right text-bright outline-none focus:border-blue-500" />
              </span>
            )}
          </div>
        </Field>
        {freq !== "none" && (
          <Field label="Ends">
            <div className="flex flex-col items-end gap-1.5">
              <select value={endsMode} onChange={(e) => setEndsMode(e.target.value as EndsMode)} className={selCls}>
                <option value="never">Never</option>
                <option value="onDate">On date</option>
                <option value="afterN">After…</option>
              </select>
              {endsMode === "onDate" && (
                <input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)} className={inputCls} />
              )}
              {endsMode === "afterN" && (
                <span className="flex items-center gap-1 text-xs text-dim">
                  <input type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))}
                    className="w-16 rounded border border-edge-strong bg-canvas px-2 py-1 text-right text-bright outline-none focus:border-blue-500" />
                  occurrences
                </span>
              )}
            </div>
          </Field>
        )}

        <Field label="Alert">
          <select value={leadMinutes} onChange={(e) => setLeadMinutes(Number(e.target.value))} className={selCls}>
            {LEAD_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </Field>

        <div className="space-y-2 rounded border border-edge bg-canvas/50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-dim">Notify via</div>
          <ChannelToggle label="In-app toast" checked={inApp} onChange={setInApp} />
          <ChannelToggle label="Read aloud" checked={speak} onChange={setSpeak} />
          <ChannelToggle label="Pushover (phone)" checked={pushover} onChange={setPushover} />
          {pushover && !pushoverConfigured && (
            <div className="text-xs text-amber-400">Add your Pushover keys in Settings → Voice &amp; Speech first.</div>
          )}
          {pushover && (
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className={selCls}>
                {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </Field>
          )}
        </div>

        <Field label="Image" hint="Optional">
          <div className="flex flex-col items-end gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0])}
              className="text-xs text-dim file:mr-2 file:rounded file:border-0 file:bg-elevated file:px-2 file:py-1 file:text-fg hover:file:bg-edge" />
            {previewSrc && (
              <div className="relative">
                <img src={previewSrc} alt="" className="max-h-24 rounded border border-edge" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <button type="button" onClick={clearImage}
                  className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-error/80 text-xs text-white">×</button>
              </div>
            )}
            {imgError && <div className="text-xs text-red-400">{imgError}</div>}
          </div>
        </Field>
      </div>

      <div className="shrink-0 border-t border-edge px-4 py-3">
        {error && <div className="mb-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200">{error}</div>}
        <div className="flex items-center justify-between gap-2">
          {initial
            ? <button onClick={del} disabled={busy} className="rounded px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50">Delete</button>
            : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded bg-surface px-3 py-1.5 text-sm text-fg hover:bg-elevated">Cancel</button>
            <button onClick={submit} disabled={!canSave}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
              {busy ? "Saving…" : initial ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = "rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500";
const selCls = "rounded border border-edge-strong bg-canvas px-2 py-1 text-bright outline-none focus:border-blue-500";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="pt-1.5 text-fg">{label}{hint && <span className="ml-1 text-xs text-dim">{hint}</span>}</div>
      {children}
    </div>
  );
}

function ChannelToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between">
      <span className="text-fg">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-blue-500" />
    </label>
  );
}
