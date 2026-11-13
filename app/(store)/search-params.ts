import { discoverySearchSchema, type DiscoverySearch } from '@/lib/catalog';

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const many = (v: string | string[] | undefined) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap((x) => x.split(',')).filter(Boolean));
const int = (v: string | string[] | undefined) => {
  const s = first(v);
  if (!s || !/^\d{1,5}$/.test(s)) return undefined;
  return Number(s);
};

/** URL query to a validated search; anything malformed falls back to the plain catalog instead of an error page. */
export function parseSearch(raw: Raw): DiscoverySearch {
  const parsed = discoverySearchSchema.safeParse({
    q: first(raw.q),
    genre: many(raw.genre),
    mood: many(raw.mood),
    lang: many(raw.lang),
    price: many(raw.price),
    tier: many(raw.tier),
    bpmMin: int(raw.bpmMin),
    bpmMax: int(raw.bpmMax),
    durMin: int(raw.durMin),
    durMax: int(raw.durMax),
    sort: first(raw.sort),
    page: int(raw.page),
  });
  return parsed.success ? parsed.data : discoverySearchSchema.parse({});
}

type ListKey = 'genre' | 'mood' | 'lang' | 'price' | 'tier';

/** The URL for a search, in a stable order and with defaults left out. */
export function searchHref(s: DiscoverySearch): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  for (const k of ['genre', 'mood', 'lang', 'price', 'tier'] as const) if (s[k].length) p.set(k, s[k].join(','));
  for (const k of ['bpmMin', 'bpmMax', 'durMin', 'durMax'] as const) if (s[k] !== undefined) p.set(k, String(s[k]));
  if (s.sort !== 'relevance') p.set('sort', s.sort);
  if (s.page > 1) p.set('page', String(s.page));
  const q = p.toString();
  return q ? `/?${q}` : '/';
}

/** The same search with one option switched on or off (and back to the first page). */
export function toggled(s: DiscoverySearch, key: ListKey, value: string): string {
  const has = (s[key] as string[]).includes(value);
  const next = has ? (s[key] as string[]).filter((v) => v !== value) : [...(s[key] as string[]), value];
  return searchHref({ ...s, [key]: next, page: 1 });
}

/** The same search with a range or sort replaced (and back to the first page). */
export function withParams(s: DiscoverySearch, patch: Partial<DiscoverySearch>): string {
  return searchHref({ ...s, ...patch, page: patch.page ?? 1 });
}
