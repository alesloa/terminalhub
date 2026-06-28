// Fetches the iptv-org public API datasets, joins them via normalizeCatalog, and caches the result
// for 24h in tv_catalog_cache. The eight JSON files are large but static-ish; one daily fetch keeps
// the channel browser instant without hammering iptv-org on every open. `refresh:true` forces a
// re-fetch (the user's manual "refresh catalog"). Optional files (logos/feeds/blocklist) degrade to
// [] on failure; channels/streams are required and throw if they can't be fetched.

import type { Store } from "../db/store.js";
import { normalizeCatalog, type Catalog, type RawSources } from "./normalize.js";

const BASE = "https://iptv-org.github.io/api/";
const TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJson(file: string): Promise<any> {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`iptv-org ${file}: ${res.status}`);
  return res.json();
}

// An optional dataset: a failure (network / 404 / parse) should not sink the whole catalog.
async function fetchOptional(file: string): Promise<any[]> {
  try {
    const v = await fetchJson(file);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function fetchCatalog(store: Store, opts?: { refresh?: boolean }): Promise<Catalog> {
  if (!opts?.refresh) {
    const cached = store.getTvCache("catalog");
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      try {
        return JSON.parse(cached.json) as Catalog;
      } catch {
        // fall through to a fresh fetch on a corrupt cache
      }
    }
  }

  // channels + streams are required (a failure throws); the rest are best-effort.
  const [channels, streams, categories, countries, languages, logos, feeds, blocklist] = await Promise.all([
    fetchJson("channels.json"),
    fetchJson("streams.json"),
    fetchOptional("categories.json"),
    fetchOptional("countries.json"),
    fetchOptional("languages.json"),
    fetchOptional("logos.json"),
    fetchOptional("feeds.json"),
    fetchOptional("blocklist.json"),
  ]);

  const raw: RawSources = { channels, streams, categories, countries, languages, logos, feeds, blocklist };
  const catalog = normalizeCatalog(raw);
  store.setTvCache("catalog", JSON.stringify(catalog));
  return catalog;
}
