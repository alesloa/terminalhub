import { create } from "zustand";
import type { TvChannel, RadioStation, YouTubeItem } from "../../api/types";

// Ephemeral player state for the TV/Media tool (the open mode, what's playing, volume, and the TV
// browse filters). Volume is mirrored to localStorage so it survives reloads; the modal also pushes
// it to the server settings (debounced) so an agent/other client can read it.
export type TvMode = "tv" | "radio" | "youtube";

export interface TvFilters {
  search: string;
  categories: string[];
  countries: string[]; // country codes
  languages: string[]; // language codes
  favOnly: boolean;
  hdOnly: boolean;
}

const VOL_KEY = "tr.tvVolume";
function initialVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    if (Number.isFinite(v) && v >= 0 && v <= 100) return v;
  } catch { /* storage blocked */ }
  return 80;
}

const SUB_COLOR_KEY = "tr.tvSubColor";
const AUDIO_LANG_KEY = "tr.tvAudioLang";
function read(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

const EMPTY_FILTERS: TvFilters = { search: "", categories: [], countries: [], languages: [], favOnly: false, hdOnly: false };

interface TvStore {
  mode: TvMode;
  channel: TvChannel | null;
  station: RadioStation | null;
  video: YouTubeItem | null;
  playing: boolean;
  volume: number; // 0..100
  muted: boolean;
  filters: TvFilters;
  subtitleColor: string; // caption text color (video::cue), persisted
  preferredAudioLang: string; // remembered audio language, auto-applied to multi-audio streams
  setMode: (m: TvMode) => void;
  playChannel: (c: TvChannel) => void;
  playStation: (s: RadioStation) => void;
  playVideo: (v: YouTubeItem) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  patchFilters: (p: Partial<TvFilters>) => void;
  toggleArrayFilter: (key: "categories" | "countries" | "languages", value: string) => void;
  clearFilters: () => void;
  setSubtitleColor: (c: string) => void;
  setPreferredAudioLang: (l: string) => void;
}

export const useTv = create<TvStore>((set) => ({
  mode: "tv",
  channel: null,
  station: null,
  video: null,
  playing: false,
  volume: initialVolume(),
  muted: false,
  filters: { ...EMPTY_FILTERS },
  subtitleColor: read(SUB_COLOR_KEY, "#ffffff"),
  preferredAudioLang: read(AUDIO_LANG_KEY, ""),
  setMode: (mode) => set({ mode }),
  playChannel: (channel) => set({ channel, mode: "tv", playing: true }),
  playStation: (station) => set({ station, mode: "radio", playing: true }),
  playVideo: (video) => set({ video, mode: "youtube", playing: true }),
  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setVolume: (volume) => {
    try { localStorage.setItem(VOL_KEY, String(volume)); } catch { /* blocked */ }
    set({ volume, muted: volume > 0 ? false : true });
  },
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  patchFilters: (p) => set((s) => ({ filters: { ...s.filters, ...p } })),
  toggleArrayFilter: (key, value) =>
    set((s) => {
      const cur = s.filters[key];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { filters: { ...s.filters, [key]: next } };
    }),
  // Clears the filter pills (categories/countries/languages/toggles) but keeps the search text.
  clearFilters: () => set((s) => ({ filters: { ...EMPTY_FILTERS, search: s.filters.search } })),
  setSubtitleColor: (subtitleColor) => {
    try { localStorage.setItem(SUB_COLOR_KEY, subtitleColor); } catch { /* blocked */ }
    set({ subtitleColor });
  },
  setPreferredAudioLang: (preferredAudioLang) => {
    try { localStorage.setItem(AUDIO_LANG_KEY, preferredAudioLang); } catch { /* blocked */ }
    set({ preferredAudioLang });
  },
}));
