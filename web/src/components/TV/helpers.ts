import type { TvChannel, TvStream, RadioStation } from "../../api/types";

// Small pure helpers shared across the TV components: monogram + deterministic gradient for the logo
// tiles (matches the locked mockup's colored channel avatars), stream selection, and a single place to
// push the store's volume/muted/playing onto a <video>/<audio> element.

/** Two-letter monogram for a name (used when a channel/station has no logo image). */
export function monogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "TV";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Deterministic two-stop gradient for a logo tile, seeded by the name so a channel keeps its color. */
export function gradientFor(seed: string): string {
  const h = hashHue(seed || "tv");
  return `linear-gradient(135deg, hsl(${h} 52% 30%), hsl(${(h + 26) % 360} 58% 46%))`;
}

/** Best stream for a channel: prefer the highest declared resolution, else the first listed. */
export function bestStream(channel: TvChannel, hdOnly = false): TvStream | null {
  const streams = channel.streams;
  if (streams.length === 0) return null;
  const heightOf = (s: TvStream) => {
    const m = s.quality?.match(/(\d{3,4})/);
    return m ? Number(m[1]) : 0;
  };
  const sorted = [...streams].sort((a, b) => heightOf(b) - heightOf(a));
  if (hdOnly) return sorted.find((s) => heightOf(s) >= 720) ?? sorted[0];
  return sorted[0];
}

/** Does any of a channel's streams declare 720p+? (drives the "HD only" filter and the HD badge.) */
export function isHd(channel: TvChannel): boolean {
  return channel.streams.some((s) => {
    const m = s.quality?.match(/(\d{3,4})/);
    return m ? Number(m[1]) >= 720 : false;
  });
}

/** Short quality label for a channel row, e.g. "1080p" — empty when unknown. */
export function channelQuality(channel: TvChannel): string {
  const best = bestStream(channel);
  return best?.quality ?? "";
}

/** Apply the store's playback state to a media element. Returns nothing; call from an effect. */
export function applyMediaState(
  el: HTMLMediaElement | null,
  state: { volume: number; muted: boolean; playing: boolean },
) {
  if (!el) return;
  el.volume = Math.min(1, Math.max(0, state.volume / 100));
  el.muted = state.muted;
  if (state.playing) {
    void el.play().catch(() => {});
  } else {
    el.pause();
  }
}

/** A short subtitle for a radio station row: bitrate + codec + country. */
export function stationSub(s: RadioStation): string {
  const parts: string[] = [];
  if (s.bitrate) parts.push(`${s.bitrate}kbps`);
  if (s.codec) parts.push(s.codec.toUpperCase());
  if (s.country) parts.push(s.country);
  return parts.join(" · ");
}
