import { sql, type SQL } from 'drizzle-orm';
import { genres, moods } from '@/db/schema';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/lib/platform/db';
import {
  DISCOVERY_PAGE_SIZE,
  LANGUAGES,
  PRICE_LEVELS,
  DISCOVERY_TIERS,
  type DiscoveryFacets,
  type DiscoverySearch,
  type DiscoveryTier,
  type FacetOption,
  type TrackCard,
} from '../index';

/*
 * Public discovery reads (PLAN S4-M8). Only tracks that can be bought today are listed: published, class A or B,
 * an active seller, a ready current version with a preview, a price level whose price is in the active book, and
 * at least one tier on offer. That is the same standing `quoteLicense` checks, so a listed track is never a dead end.
 * Seller identity, storage keys and sales figures never leave this file.
 */

const list = (items: readonly string[], type: 'uuid' | 'text') => sql`ARRAY[${sql.join(items.map((i) => sql`${i}`), sql`, `)}]::${sql.raw(type)}[]`;

const offers = (tier: DiscoveryTier): SQL => {
  const flag = tier === 'paid_ad' ? sql`t.paid_ads` : sql`t.organic_social`;
  return sql`(${flag} AND EXISTS (SELECT 1 FROM price_book_entries e JOIN price_books b ON b.id = e.price_book_id WHERE b.status = 'active' AND e.price_level = t.price_level AND e.tier = ${tier}))`;
};
const TIERS_ARRAY = sql`array_remove(ARRAY[CASE WHEN ${offers('creator')} THEN 'creator' END, CASE WHEN ${offers('brand_organic')} THEN 'brand_organic' END, CASE WHEN ${offers('paid_ad')} THEN 'paid_ad' END]::text[], NULL)`;
const SALES = sql`(SELECT count(*) FROM licenses l WHERE l.track_id = t.id AND l.status <> 'revoked')`;
const MOOD_NAMES = sql`(SELECT coalesce(array_agg(m.name ORDER BY m.name), '{}') FROM moods m WHERE m.id = ANY(t.mood_ids))`;

const FROM_SELLABLE = sql`
  FROM tracks t
  JOIN seller_profiles sp ON sp.org_id = t.seller_org_id AND sp.status = 'active'
  JOIN track_versions v ON v.id = t.current_version_id AND v.ingest_status = 'ready' AND v.master_sha256 IS NOT NULL AND v.preview_key IS NOT NULL
  LEFT JOIN genres g ON g.id = t.genre_id
  WHERE t.status = 'published' AND t.clearance_class IN ('A', 'B') AND t.price_level IS NOT NULL
    AND (${offers('creator')} OR ${offers('brand_organic')} OR ${offers('paid_ad')})`;

type Facet = 'genre' | 'mood' | 'lang' | 'price' | 'tier' | 'bpm' | 'dur';

/** Letters and digits only, so a term can never carry tsquery syntax. */
const terms = (q?: string): string[] => q?.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];

function textMatch(tokens: string[]) {
  const phrase = tokens.join(' ');
  const tsq = sql`to_tsquery('simple', ${tokens.map((t) => `${t}:*`).join(' & ')})`;
  // Mood and genre names are matched as words too, so "Lo-fi" or "Feel good" are found by what a person would type.
  const moodOrGenre = sql`(to_tsvector('simple', coalesce(g.name, '')) @@ ${tsq} OR EXISTS (SELECT 1 FROM moods m WHERE m.id = ANY(t.mood_ids) AND to_tsvector('simple', m.name) @@ ${tsq}))`;
  const match = sql`(to_tsvector('simple', t.title || ' ' || t.primary_artist) @@ ${tsq} OR t.title % ${phrase}::text OR t.primary_artist % ${phrase}::text OR ${moodOrGenre})`;
  // A hit in the title weighs more than one in the artist's name; a mood or genre hit counts a little.
  const relevance = sql`(ts_rank_cd(setweight(to_tsvector('simple', t.title), 'A') || setweight(to_tsvector('simple', t.primary_artist), 'B'), ${tsq}) + greatest(similarity(t.title, ${phrase}::text), 0.6 * similarity(t.primary_artist, ${phrase}::text)) + CASE WHEN ${moodOrGenre} THEN 0.2 ELSE 0 END)`;
  return { match, relevance };
}

/** The filters as WHERE fragments; `skip` leaves one facet out so its own counts show what else could be picked. */
function conditions(s: DiscoverySearch, skip?: Facet): SQL[] {
  const c: SQL[] = [];
  if (s.genre.length && skip !== 'genre') c.push(sql`t.genre_id = ANY(${list(s.genre, 'uuid')})`);
  if (s.mood.length && skip !== 'mood') c.push(sql`t.mood_ids && ${list(s.mood, 'uuid')}`);
  if (s.lang.length && skip !== 'lang') c.push(sql`t.language = ANY(${list(s.lang, 'text')})`);
  if (s.price.length && skip !== 'price') c.push(sql`t.price_level = ANY(${list(s.price, 'text')})`);
  if (s.tier.length && skip !== 'tier') c.push(sql`${TIERS_ARRAY} @> ${list(s.tier, 'text')}`);
  if (skip !== 'bpm') {
    if (s.bpmMin !== undefined) c.push(sql`t.bpm >= ${s.bpmMin}`);
    if (s.bpmMax !== undefined) c.push(sql`t.bpm <= ${s.bpmMax}`);
  }
  if (skip !== 'dur') {
    if (s.durMin !== undefined) c.push(sql`v.duration_ms >= ${s.durMin * 1000}`);
    if (s.durMax !== undefined) c.push(sql`v.duration_ms <= ${s.durMax * 1000}`);
  }
  const tokens = terms(s.q);
  if (tokens.length) c.push(textMatch(tokens).match);
  return c;
}

const where = (c: SQL[]) => (c.length ? sql` AND ${sql.join(c, sql` AND `)}` : sql``);

const CARD_COLUMNS = sql`t.id, t.slug, t.title, t.primary_artist, t.language, t.bpm, coalesce(v.duration_ms, 0) AS duration_ms, g.name AS genre, t.price_level, ${MOOD_NAMES} AS moods, ${TIERS_ARRAY} AS tiers`;

type CardRow = {
  id: string;
  slug: string;
  title: string;
  primary_artist: string;
  language: TrackCard['language'];
  bpm: number | null;
  duration_ms: number;
  genre: string | null;
  price_level: TrackCard['priceLevel'];
  moods: string[];
  tiers: DiscoveryTier[];
};

const toCard = (r: CardRow): TrackCard => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  primaryArtist: r.primary_artist,
  language: r.language,
  bpm: r.bpm,
  durationMs: Number(r.duration_ms),
  genre: r.genre,
  moods: r.moods,
  priceLevel: r.price_level,
  tiers: r.tiers,
});

/**
 * Browse and faceted search. Order: relevance (full-text rank plus trigram similarity, in 0.1 steps so near ties fall
 * through), then licenses sold, then newest. Without a query every track is equally relevant, so it is sales then recency.
 */
export async function searchTracks(db: DbOrTx, s: DiscoverySearch): Promise<{ tracks: TrackCard[]; total: number; page: number; pages: number }> {
  const tokens = terms(s.q);
  const bySales = sql`${SALES} DESC, t.published_at DESC, t.id`;
  const order =
    s.sort === 'newest' ? sql`t.published_at DESC, t.id` : s.sort === 'licensed' || !tokens.length ? bySales : sql`round((${textMatch(tokens).relevance})::numeric, 1) DESC, ${bySales}`;
  const rows = await db.execute<CardRow & { total: string }>(sql`
    SELECT ${CARD_COLUMNS}, count(*) OVER () AS total
    ${FROM_SELLABLE}${where(conditions(s))}
    ORDER BY ${order}
    LIMIT ${DISCOVERY_PAGE_SIZE} OFFSET ${(s.page - 1) * DISCOVERY_PAGE_SIZE}`);
  const total = rows.length ? Number(rows[0]!.total) : 0;
  return { tracks: rows.map(toCard), total, page: s.page, pages: Math.max(1, Math.ceil(total / DISCOVERY_PAGE_SIZE)) };
}

const labelled = (rows: { value: string; count: string }[], labels: Map<string, string> | readonly string[]): FacetOption[] => {
  const counts = new Map(rows.map((r) => [r.value, Number(r.count)]));
  const values = Array.isArray(labels) ? [...labels] : [...(labels as Map<string, string>).keys()];
  return values.map((value) => ({ value, label: Array.isArray(labels) ? value : (labels as Map<string, string>).get(value)!, count: counts.get(value) ?? 0 }));
};

/** Counts per option with every other filter applied, and the BPM range of what is on sale (for the slider). */
export async function facetCounts(db: DbOrTx, s: DiscoverySearch): Promise<DiscoveryFacets> {
  const group = (select: SQL, skip: Facet) => db.execute<{ value: string; count: string }>(sql`SELECT value, count(*) AS count FROM (SELECT ${select} AS value ${FROM_SELLABLE}${where(conditions(s, skip))}) x WHERE value IS NOT NULL GROUP BY value`);
  const [genreTax, moodTax, genreRows, moodRows, langRows, tierRows, priceRows, [bounds]] = await Promise.all([
    db.select({ id: genres.id, name: genres.name }).from(genres).where(eq(genres.active, true)).orderBy(genres.name),
    db.select({ id: moods.id, name: moods.name }).from(moods).where(eq(moods.active, true)).orderBy(moods.name),
    group(sql`t.genre_id::text`, 'genre'),
    group(sql`unnest(t.mood_ids)::text`, 'mood'),
    group(sql`t.language`, 'lang'),
    group(sql`unnest(${TIERS_ARRAY})`, 'tier'),
    group(sql`t.price_level`, 'price'),
    db.execute<{ min: number | null; max: number | null }>(sql`SELECT min(t.bpm) AS min, max(t.bpm) AS max ${FROM_SELLABLE}`),
  ]);
  return {
    genres: labelled(genreRows, new Map(genreTax.map((g) => [g.id, g.name]))),
    moods: labelled(moodRows, new Map(moodTax.map((m) => [m.id, m.name]))),
    languages: labelled(langRows, LANGUAGES),
    tiers: labelled(tierRows, DISCOVERY_TIERS),
    priceLevels: labelled(priceRows, PRICE_LEVELS),
    bpm: bounds?.min != null && bounds.max != null ? { min: Number(bounds.min), max: Number(bounds.max) } : null,
  };
}

/**
 * Alternatives to a track: the same genre and overlapping moods, tempo within 10 BPM, at or below its price level,
 * most similar first, then most licensed. Never the track itself; with `tier`, only tracks that offer that tier
 * (an alternative nobody can buy is no alternative). Needs the same genre or at least one shared mood to qualify.
 */
export async function suggestTracks(db: DbOrTx, trackId: string, opts: { tier?: DiscoveryTier; limit?: number } = {}): Promise<TrackCard[]> {
  const [src] = await db.execute<{ genre_id: string | null; mood_ids: string[]; bpm: number | null; price_level: string | null }>(sql`SELECT genre_id, mood_ids, bpm, price_level FROM tracks WHERE id = ${trackId}`);
  if (!src || (!src.genre_id && src.mood_ids.length === 0)) return [];
  const moodArr = src.mood_ids.length ? list(src.mood_ids, 'uuid') : sql`'{}'::uuid[]`;
  const sameGenre = src.genre_id ? sql`t.genre_id = ${src.genre_id}::uuid` : sql`false`;
  const bpmClose = src.bpm === null ? sql`false` : sql`t.bpm BETWEEN ${src.bpm - 10} AND ${src.bpm + 10}`;
  const cheaper = src.price_level ? sql`t.price_level <= ${src.price_level}` : sql`false`;
  const tierOffered = opts.tier ? sql` AND ${offers(opts.tier)}` : sql``;
  const rows = await db.execute<CardRow>(sql`
    SELECT ${CARD_COLUMNS}
    ${FROM_SELLABLE} AND t.id <> ${trackId}::uuid AND (${sameGenre} OR t.mood_ids && ${moodArr})${tierOffered}
    ORDER BY (CASE WHEN ${sameGenre} THEN 2 ELSE 0 END)
           + (SELECT count(*) FROM unnest(t.mood_ids) mid WHERE mid = ANY(${moodArr}))
           + (CASE WHEN ${bpmClose} THEN 1 ELSE 0 END)
           + (CASE WHEN ${cheaper} THEN 1 ELSE 0 END) DESC,
           ${SALES} DESC, t.published_at DESC, t.id
    LIMIT ${Math.min(opts.limit ?? 8, 24)}`);
  return rows.map(toCard);
}
