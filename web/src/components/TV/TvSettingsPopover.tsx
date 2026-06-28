import { useEffect, useRef, useState } from "react";
import type { TvSettings } from "../../api/types";

interface Props {
  settings?: TvSettings;
  onSave: (b: { youtubeApiKey?: string; nsfw?: boolean }) => void;
  onClose: () => void;
}

/** A small popover (anchored top-right under the title-bar gear) for the YouTube Data API key and the
 *  NSFW toggle. The key is write-only — the server only ever tells us whether one is set. */
export function TvSettingsPopover({ settings, onSave, onClose }: Props) {
  const [key, setKey] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const saveKey = () => {
    const v = key.trim();
    if (!v) return;
    onSave({ youtubeApiKey: v });
    setKey("");
  };

  return (
    <div ref={ref}
      className="absolute right-3 top-12 z-10 w-[320px] rounded-xl border border-edge-strong bg-elevated shadow-2xl p-4 text-[12.5px]">
      <div className="font-semibold text-bright text-[13px] mb-3">TV settings</div>

      <label className="block text-dim mb-1.5">YouTube Data API key</label>
      <div className="flex gap-2">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
          placeholder={settings?.hasYoutubeKey ? "•••••••••• (set)" : "Paste your API key"}
          className="flex-1 min-w-0 bg-surface border border-edge rounded-lg px-2.5 h-8 outline-none text-fg placeholder:text-dim focus:border-edge-strong" />
        <button onClick={saveKey} disabled={!key.trim()}
          className="px-3 h-8 rounded-lg bg-accent text-accent-fg font-medium disabled:opacity-40">Save</button>
      </div>
      <p className="text-dim text-[11px] mt-1.5 leading-snug">
        Enables the YouTube tab. Stored on the server, never returned to the browser.
        {settings?.hasYoutubeKey && <button onClick={() => onSave({ youtubeApiKey: "" })} className="ml-1 text-error hover:underline">Clear key</button>}
      </p>

      <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
        <input type="checkbox" checked={!!settings?.nsfw} onChange={(e) => onSave({ nsfw: e.target.checked })}
          className="w-4 h-4 accent-[rgb(var(--tr-accent))] cursor-pointer" />
        <span className="text-fg">Show adult (NSFW) channels</span>
      </label>
    </div>
  );
}
