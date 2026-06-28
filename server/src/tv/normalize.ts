// Joins the raw iptv-org API datasets into one browsable channel list + sidebar facets. Pure: the
// route fetches/caches the JSON (sources.ts) and hands the arrays here. Only channels that have at
// least one playable stream and aren't blocklisted/closed are emitted.

export interface RawChannel {
  id: string;
  name: string;
  country?: string | null;
  categories?: string[];
  is_nsfw?: boolean;
  closed?: string | null;
}
export interface RawStream {
  channel: string | null;
  url: string;
  quality?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
}
export interface RawCategory { id: string; name: string }
export interface RawCountry { code: string; name: string; flag?: string; languages?: string[] }
export interface RawLanguage { code: string; name: string }
export interface RawLogo { channel: string; url: string; width?: number; height?: number }
export interface RawFeed { channel: string; is_main?: boolean; languages?: string[] }
export interface RawBlock { channel: string }

export interface RawSources {
  channels: RawChannel[];
  streams: RawStream[];
  categories: RawCategory[];
  countries: RawCountry[];
  languages: RawLanguage[];
  logos: RawLogo[];
  feeds: RawFeed[];
  blocklist: RawBlock[];
}

export interface Stream { url: string; quality: string | null; referrer: string | null; userAgent: string | null }
export interface Channel {
  id: string;
  name: string;
  logo: string | null;
  categories: string[];
  country: { code: string; name: string; flag: string } | null;
  languages: string[];
  isNsfw: boolean;
  streams: Stream[];
}
export interface Catalog {
  channels: Channel[];
  facets: {
    categories: { id: string; name: string; count: number }[];
    countries: { code: string; name: string; flag: string; count: number }[];
    languages: { code: string; name: string; count: number }[];
  };
}

export function normalizeCatalog(raw: RawSources): Catalog {
  const blocked = new Set(raw.blocklist.map((b) => b.channel));
  const catName = new Map(raw.categories.map((c) => [c.id, c.name]));
  const country = new Map(raw.countries.map((c) => [c.code, c]));
  const langName = new Map(raw.languages.map((l) => [l.code, l.name]));

  // streams grouped by channel id (orphans with channel=null are skipped)
  const streamsByCh = new Map<string, Stream[]>();
  for (const s of raw.streams) {
    if (!s.channel || !s.url) continue;
    const list = streamsByCh.get(s.channel) ?? [];
    list.push({
      url: s.url,
      quality: s.quality ?? null,
      referrer: s.referrer ?? null,
      userAgent: s.user_agent ?? null,
    });
    streamsByCh.set(s.channel, list);
  }

  // largest logo per channel (prefer biggest pixel area)
  const logoByCh = new Map<string, { url: string; area: number }>();
  for (const lg of raw.logos) {
    if (!lg.channel || !lg.url) continue;
    const area = (lg.width ?? 0) * (lg.height ?? 0);
    const cur = logoByCh.get(lg.channel);
    if (!cur || area > cur.area) logoByCh.set(lg.channel, { url: lg.url, area });
  }

  // main-feed languages per channel (fallback handled below against country)
  const feedLangByCh = new Map<string, string[]>();
  for (const f of raw.feeds) {
    if (!f.channel || !f.languages?.length) continue;
    if (f.is_main || !feedLangByCh.has(f.channel)) feedLangByCh.set(f.channel, f.languages);
  }

  const channels: Channel[] = [];
  for (const ch of raw.channels) {
    const streams = streamsByCh.get(ch.id);
    if (!streams || streams.length === 0) continue; // no playable stream
    if (blocked.has(ch.id)) continue;
    if (ch.closed) continue;

    const co = ch.country ? country.get(ch.country) : undefined;
    const langCodes = feedLangByCh.get(ch.id) ?? co?.languages ?? [];

    channels.push({
      id: ch.id,
      name: ch.name,
      logo: logoByCh.get(ch.id)?.url ?? null,
      categories: (ch.categories ?? []).map((id) => catName.get(id) ?? id),
      country: co ? { code: co.code, name: co.name, flag: co.flag ?? "" } : null,
      languages: langCodes.map((c) => langName.get(c) ?? c),
      isNsfw: !!ch.is_nsfw,
      streams,
    });
  }
  channels.sort((a, b) => a.name.localeCompare(b.name));

  return { channels, facets: buildFacets(raw, channels) };
}

function buildFacets(raw: RawSources, channels: Channel[]): Catalog["facets"] {
  const catName = new Map(raw.categories.map((c) => [c.id, c.name]));
  const country = new Map(raw.countries.map((c) => [c.code, c]));
  const langName = new Map(raw.languages.map((l) => [l.code, l.name]));
  const langCodeByName = new Map(raw.languages.map((l) => [l.name, l.code]));

  const cat = new Map<string, number>();
  const cou = new Map<string, number>();
  const lang = new Map<string, number>();
  for (const ch of channels) {
    for (const name of ch.categories) cat.set(name, (cat.get(name) ?? 0) + 1);
    if (ch.country) cou.set(ch.country.code, (cou.get(ch.country.code) ?? 0) + 1);
    for (const name of ch.languages) lang.set(name, (lang.get(name) ?? 0) + 1);
  }
  const idByCatName = new Map(raw.categories.map((c) => [c.name, c.id]));

  return {
    categories: [...cat].map(([name, count]) => ({ id: idByCatName.get(name) ?? name, name, count }))
      .sort((a, b) => b.count - a.count),
    countries: [...cou].map(([code, count]) => {
      const c = country.get(code);
      return { code, name: c?.name ?? code, flag: c?.flag ?? "", count };
    }).sort((a, b) => b.count - a.count),
    languages: [...lang].map(([name, count]) => ({ code: langCodeByName.get(name) ?? name, name, count }))
      .sort((a, b) => b.count - a.count),
  };
}
