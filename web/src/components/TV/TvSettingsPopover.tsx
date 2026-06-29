import { useEffect, useRef, useState } from "react";
import type { TvSettings } from "../../api/types";
import { useTv } from "./store";
import { useYtBans, useYtDeletions } from "./useTvData";
import { EyeIcon, EyeOffIcon } from "./icons";

interface Props {
  settings?: TvSettings;
  onSave: (b: { youtubeApiKey?: string; nsfw?: boolean }) => void;
  onClose: () => void;
}

/** A small popover (anchored top-right under the title-bar gear) for the YouTube Data API key and the
 *  NSFW toggle. The key is write-only — the server only ever tells us whether one is set. */
export function TvSettingsPopover({ settings, onSave, onClose }: Props) {
  const [key, setKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const preferredAudioLang = useTv((s) => s.preferredAudioLang);
  const setPreferredAudioLang = useTv((s) => s.setPreferredAudioLang);
  const bans = useYtBans();
  const { unban } = useYtDeletions();
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
        <div className="flex-1 min-w-0 flex items-center bg-surface border border-edge rounded-lg pl-2.5 pr-1 h-8 focus-within:border-edge-strong">
          <input type={reveal ? "text" : "password"} value={key} onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
            placeholder={settings?.hasYoutubeKey ? "•••••••••• (set)" : "Paste your API key"}
            className="flex-1 min-w-0 bg-transparent outline-none text-fg placeholder:text-dim" />
          <button type="button" onClick={() => setReveal((r) => !r)} title={reveal ? "Hide key" : "Show key"}
            className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-dim hover:text-fg">
            {reveal ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
          </button>
        </div>
        <button onClick={saveKey} disabled={!key.trim()}
          className="px-3 h-8 rounded-lg bg-accent text-accent-fg font-medium disabled:opacity-40">Save</button>
      </div>
      <p className="text-dim text-[11px] mt-1.5 leading-snug">
        Enables the YouTube tab. Stored on the server, never returned to the browser.
        {settings?.hasYoutubeKey && <button onClick={() => onSave({ youtubeApiKey: "" })} className="ml-1 text-error hover:underline">Clear key</button>}
      </p>

      <label className="block text-dim mt-4 mb-1.5">Preferred audio language</label>
      <input value={preferredAudioLang} onChange={(e) => setPreferredAudioLang(e.target.value)}
        placeholder="e.g. English, spa, fr"
        className="w-full bg-surface border border-edge rounded-lg px-2.5 h-8 outline-none text-fg placeholder:text-dim focus:border-edge-strong" />
      <p className="text-dim text-[11px] mt-1.5 leading-snug">Auto-selected on channels that carry more than one audio track.</p>

      <label className="flex items-center gap-2.5 mt-4 cursor-pointer select-none">
        <input type="checkbox" checked={!!settings?.nsfw} onChange={(e) => onSave({ nsfw: e.target.checked })}
          className="w-4 h-4 accent-[rgb(var(--tr-accent))] cursor-pointer" />
        <span className="text-fg">Show adult (NSFW) channels</span>
      </label>

      <div className="mt-4 pt-4 border-t border-edge">
        <div className="font-semibold text-fg">Banned videos{bans.data?.length ? ` (${bans.data.length})` : ""}</div>
        <p className="text-dim text-[11px] mt-1 leading-snug">Banned videos never appear in any playlist or search.</p>
        {bans.data && bans.data.length > 0 ? (
          <div className="mt-2 max-h-[200px] overflow-auto rounded-lg border border-edge">
            {bans.data.map((b) => (
              <div key={b.videoId} className="flex items-center gap-2.5 px-2.5 py-2 border-b border-edge last:border-b-0">
                <div className="w-[56px] h-[32px] rounded-[5px] overflow-hidden bg-surface shrink-0">
                  {b.thumbnail && <img src={b.thumbnail} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] text-fg">{b.title || b.videoId}</div>
                  {b.channelTitle && <div className="truncate text-[10.5px] text-dim">{b.channelTitle}</div>}
                </div>
                <button onClick={() => unban.mutate(b.videoId)}
                  className="shrink-0 rounded-md border border-edge bg-surface px-2.5 py-1 text-[11.5px] text-muted hover:bg-elevated hover:text-fg">Unban</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-dim text-[11px] mt-2">Nothing banned.</p>
        )}
      </div>
    </div>
  );
}
