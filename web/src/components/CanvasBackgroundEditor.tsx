import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { CanvasBackground } from "../api/types";
import { ColorPicker } from "./TerminalContextMenu";
import { PHOTO_WALLPAPERS, GRADIENT_WALLPAPERS, uploadRef, uploadIdOf, type WallpaperDef } from "../lib/wallpapers";

// Quick-pick dark solids (the macOS-style preset swatches). The first cell is "Theme default" (null
// color → the theme's own canvas color). The app ColorPicker + the native chip give full control.
const SOLID_PRESETS: (string | null)[] = [
  null, "#0d1117", "#161b22", "#0b1020", "#10231c", "#1a1030", "#241018", "#15171a", "#202023",
];

/** Read a File into its base64 payload (no data: prefix) + mime type, for the wallpaper upload API. */
function fileToBase64(file: File): Promise<{ dataBase64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const comma = s.indexOf(",");
      resolve({ dataBase64: comma >= 0 ? s.slice(comma + 1) : s, mimeType: file.type || "image/jpeg" });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** The shared solid/wallpaper backdrop editor. Fully controlled: it renders `value` and emits the
 *  next CanvasBackground through `onChange` (the caller persists). Used both inline in Settings →
 *  Appearance (global default) and in the per-space window. */
export function CanvasBackgroundEditor({ value, onChange }: { value: CanvasBackground; onChange: (next: CanvasBackground) => void }) {
  const set = (patch: Partial<CanvasBackground>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="flex rounded border border-edge-strong bg-canvas p-0.5">
        <ModeTab active={value.kind === "solid"} onClick={() => set({ kind: "solid" })}>Solid color</ModeTab>
        <ModeTab active={value.kind === "wallpaper"} onClick={() => set({ kind: "wallpaper" })}>Wallpaper</ModeTab>
      </div>

      {value.kind === "solid" ? <SolidPanel value={value} set={set} /> : <WallpaperPanel value={value} set={set} />}
    </div>
  );
}

function SolidPanel({ value, set }: { value: CanvasBackground; set: (p: Partial<CanvasBackground>) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 text-xs text-dim">Presets</div>
        <div className="flex flex-wrap gap-2">
          {SOLID_PRESETS.map((c, i) => {
            const selected = (value.color ?? null) === c;
            return (
              <button key={i} type="button" title={c ?? "Theme default"} onClick={() => set({ color: c })}
                className={`h-7 w-7 rounded border ${selected ? "border-white" : "border-edge-strong"} ${c ? "" : "bg-canvas"}`}
                style={c ? { background: c } : undefined}>
                {!c && <span className="text-[9px] leading-none text-muted">A</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div>
          <div className="mb-1.5 text-xs text-dim">Custom color</div>
          <ColorPicker current={value.color} onPick={(c) => set({ color: c })} minLight={6} />
        </div>
        <div>
          <div className="mb-1.5 text-xs text-dim">Exact</div>
          <label className="flex cursor-pointer items-center gap-2 rounded border border-edge-strong bg-canvas px-2 py-1.5">
            <span className="h-5 w-5 rounded border border-edge-strong" style={{ background: value.color ?? "var(--tr-bg, #111)" }} />
            <span className="font-mono text-xs text-fg">{value.color ?? "theme"}</span>
            <input type="color" value={value.color ?? "#888888"} onChange={(e) => set({ color: e.target.value })}
              className="h-0 w-0 opacity-0" aria-label="Pick an exact color" />
          </label>
        </div>
      </div>

      <OverlayControls value={value} set={set} withCheckbox />
    </div>
  );
}

function WallpaperPanel({ value, set }: { value: CanvasBackground; set: (p: Partial<CanvasBackground>) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const { data } = useQuery({ queryKey: ["wallpapers"], queryFn: api.wallpapers.list });
  const uploads = data?.wallpapers ?? [];

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { dataBase64, mimeType } = await fileToBase64(file);
      return api.wallpapers.create({ name: file.name.replace(/\.[^.]+$/, ""), mimeType, dataBase64 });
    },
    onSuccess: ({ wallpaper }) => { qc.invalidateQueries({ queryKey: ["wallpapers"] }); set({ kind: "wallpaper", wallpaper: uploadRef(wallpaper.id) }); },
    onError: (e: Error) => setErr(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.wallpapers.remove(id),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["wallpapers"] });
      if (uploadIdOf(value.wallpaper ?? "") === id) set({ wallpaper: null }); // deselect a removed one
    },
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setErr("");
    if (!file.type.startsWith("image/")) { setErr("Pick an image file."); return; }
    upload.mutate(file);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {PHOTO_WALLPAPERS.map(w => <Thumb key={w.id} def={w} selected={value.wallpaper === w.id} onClick={() => set({ kind: "wallpaper", wallpaper: w.id })} />)}
        {GRADIENT_WALLPAPERS.map(w => <Thumb key={w.id} def={w} selected={value.wallpaper === w.id} onClick={() => set({ kind: "wallpaper", wallpaper: w.id })} />)}
        {uploads.map(u => (
          <UploadThumb key={u.id} id={u.id} name={u.name}
            selected={value.wallpaper === uploadRef(u.id)}
            onClick={() => set({ kind: "wallpaper", wallpaper: uploadRef(u.id) })}
            onDelete={() => remove.mutate(u.id)} />
        ))}
        <button type="button" onClick={() => fileRef.current?.click()} disabled={upload.isPending}
          title="Upload your own wallpaper"
          className="flex aspect-video items-center justify-center rounded-md border border-dashed border-edge-strong text-2xl text-dim hover:border-blue-500 hover:text-fg disabled:opacity-50">
          {upload.isPending ? "…" : "+"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {err && <div className="text-xs text-red-300">{err}</div>}

      <OverlayControls value={value} set={set} />
    </div>
  );
}

/** Overlay/dim controls. Solid mode shows a checkbox to enable the scrim (`withCheckbox`); wallpaper
 *  mode shows just the slider (the lone overlay control). */
function OverlayControls({ value, set, withCheckbox }: { value: CanvasBackground; set: (p: Partial<CanvasBackground>) => void; withCheckbox?: boolean }) {
  const sliderEnabled = withCheckbox ? value.overlay : true;
  return (
    <div className="space-y-2">
      {withCheckbox && (
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={value.overlay} onChange={(e) => set({ overlay: e.target.checked })} className="h-4 w-4 accent-blue-500" />
          Overlay (dim the color)
        </label>
      )}
      <div className={`flex items-center gap-2 ${sliderEnabled ? "" : "opacity-40"}`}>
        <span className="w-16 text-xs text-dim">{withCheckbox ? "Dim" : "Overlay"}</span>
        <input type="range" min={0} max={100} step={1} value={value.dim} disabled={!sliderEnabled}
          onChange={(e) => set({ dim: Number(e.target.value) })} className="flex-1 accent-blue-500" />
        <span className="w-9 text-right text-xs tabular-nums text-muted">{value.dim}%</span>
      </div>
    </div>
  );
}

function Thumb({ def, selected, onClick }: { def: WallpaperDef; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" title={def.name} onClick={onClick}
      className={`relative aspect-video overflow-hidden rounded-md border ${selected ? "border-white ring-1 ring-white" : "border-edge-strong hover:border-edge"}`}
      style={{ background: def.css }}>
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/40 px-1 py-0.5 text-left text-[9px] text-white/90">{def.name}</span>
    </button>
  );
}

/** An uploaded-wallpaper thumbnail — fetches its data URL (shared cache with the backdrop renderer)
 *  and shows a delete affordance on hover. */
function UploadThumb({ id, name, selected, onClick, onDelete }: { id: string; name: string; selected: boolean; onClick: () => void; onDelete: () => void }) {
  const { data } = useQuery({ queryKey: ["wallpaper", id], queryFn: () => api.wallpapers.get(id), staleTime: Infinity });
  return (
    <div className={`group relative aspect-video overflow-hidden rounded-md border ${selected ? "border-white ring-1 ring-white" : "border-edge-strong hover:border-edge"}`}>
      <button type="button" title={name} onClick={onClick} className="absolute inset-0"
        style={{ background: data ? `center / cover no-repeat url("${data.wallpaper.dataUrl}")` : undefined }} />
      <button type="button" title="Delete wallpaper" onClick={onDelete}
        className="absolute right-0.5 top-0.5 hidden h-5 w-5 items-center justify-center rounded bg-black/60 text-xs text-white group-hover:flex hover:bg-red-600/80">×</button>
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded px-2 py-1 text-xs ${active ? "bg-edge-strong text-bright" : "text-dim hover:text-fg"}`}>
      {children}
    </button>
  );
}
