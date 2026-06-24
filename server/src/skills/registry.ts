/** One hit from the skills.sh registry search. `source` is the repo (owner/repo); `skillId` is
 * the skill folder within it — together enough to clone + install via the normal scan path. */
export interface RegistrySkill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

const DEFAULT_BASE = "https://skills.sh";

/**
 * Search the skills.sh registry: `GET <base>/api/search?q=…` → `{ skills: [...] }`. The fetcher
 * is injectable so the mapping is unit-tested without hitting the live service. Throws on a
 * non-ok response so the panel can surface the error instead of showing nothing.
 */
export async function searchRegistry(
  query: string,
  opts: { baseUrl?: string; fetcher?: Fetcher } = {},
): Promise<RegistrySkill[]> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const fetcher = opts.fetcher ?? ((url: string) => fetch(url));
  const res = await fetcher(`${base}/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`skills registry search failed (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data?.skills)) return [];
  return data.skills.map((s: any): RegistrySkill => ({
    id: String(s.id ?? ""),
    skillId: String(s.skillId ?? s.name ?? ""),
    name: String(s.name ?? s.skillId ?? ""),
    installs: Number(s.installs ?? 0),
    source: String(s.source ?? ""),
  }));
}
