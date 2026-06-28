// radio-browser.info search. Their docs ask clients to discover a server from the round-robin DNS
// pool (all.api.radio-browser.info) and send a descriptive User-Agent. The chosen base is cached for
// the process. normalizeStations is PURE (TDD'd) so the route only ever forwards already-clean rows.

export interface Station {
  id: string;
  name: string;
  favicon: string;
  url: string;
  codec: string;
  bitrate: number;
  country: string;
  tags: string[];
}

/** PURE: map radio-browser station rows to our shape; drop any with no resolvable stream URL. */
export function normalizeStations(raw: any[]): Station[] {
  const out: Station[] = [];
  for (const s of raw) {
    const url = s.url_resolved;
    if (!url) continue;
    out.push({
      id: s.stationuuid,
      name: s.name,
      favicon: s.favicon,
      url,
      codec: s.codec,
      bitrate: s.bitrate,
      country: s.countrycode,
      tags: (s.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean),
    });
  }
  return out;
}

const UA = "TerminalHub/1.0";
let serverBase: string | null = null;

// Resolve (once per process) one radio-browser API server from the discovery pool.
async function resolveServer(): Promise<string> {
  if (serverBase) return serverBase;
  const res = await fetch("https://all.api.radio-browser.info/json/servers", {
    headers: { "user-agent": UA },
  });
  const servers: any[] = await res.json();
  const name = servers.find((s) => s?.name)?.name;
  if (!name) throw new Error("no radio-browser server available");
  serverBase = "https://" + name;
  return serverBase;
}

export async function searchRadio(params: {
  q?: string;
  tag?: string;
  country?: string;
  limit?: number;
}): Promise<Station[]> {
  const base = await resolveServer();
  const url = new URL(base + "/json/stations/search");
  if (params.q) url.searchParams.set("name", params.q);
  if (params.tag) url.searchParams.set("tag", params.tag);
  if (params.country) url.searchParams.set("countrycode", params.country);
  url.searchParams.set("limit", String(params.limit || 100));
  url.searchParams.set("hidebroken", "true");
  url.searchParams.set("order", "clickcount");
  url.searchParams.set("reverse", "true");
  const res = await fetch(url.toString(), { headers: { "user-agent": UA } });
  const json: any[] = await res.json();
  return normalizeStations(json);
}

export async function radioFacets(): Promise<{ tags: any[]; countries: any[] }> {
  const base = await resolveServer();
  const headers = { "user-agent": UA };
  const [tagsRes, countriesRes] = await Promise.all([
    fetch(base + "/json/tags?hidebroken=true&order=stationcount&reverse=true&limit=60", { headers }),
    fetch(base + "/json/countries", { headers }),
  ]);
  const [tags, countries] = await Promise.all([tagsRes.json(), countriesRes.json()]);
  return { tags, countries };
}
