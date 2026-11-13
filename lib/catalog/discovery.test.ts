import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { genres, moods, sellerProfiles, trackVersions, tracks } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { setupCommerce, sale } from '@/tests/commerce';
import { makeSeller, makeSellableTrack } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { discoverySearchSchema, type DiscoverySearch } from './index';
import { facetCounts, searchTracks, suggestTracks } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 200_000, L3: 300_000, L4: 400_000, L5: 500_000 }));

const search = (over: Partial<DiscoverySearch> = {}) => discoverySearchSchema.parse(over);
const rnd = () => Math.random().toString(36).slice(2, 8);

/** A fresh genre and moods, so each test sees only its own fixtures whatever else is in the database. */
async function taxonomy() {
  const [g] = await db.insert(genres).values({ name: `genre-${rnd()}` }).returning();
  const [calm, lively] = await db.insert(moods).values([{ name: `calm-${rnd()}` }, { name: `lively-${rnd()}` }]).returning();
  return { genre: g!, calm: calm!, lively: lively! };
}

type Listed = { title?: string; artist?: string; genreId?: string | null; moodIds?: string[]; language?: string; bpm?: number | null; durationMs?: number; level?: string | null; organic?: boolean; paid?: boolean; status?: string; cls?: 'A' | 'B' | 'C'; preview?: boolean; at?: Date; sellerOrgId?: string };

/** Sets the searchable facts of an existing track and its current version. */
async function shape(trackId: string, o: Listed) {
  await db
    .update(tracks)
    .set({ title: o.title ?? `Song ${rnd()}`, primaryArtist: o.artist ?? 'Some Artist', genreId: o.genreId ?? null, moodIds: o.moodIds ?? [], language: o.language ?? 'hindi', bpm: o.bpm === undefined ? 100 : o.bpm, publishedAt: o.at ?? new Date() })
    .where(eq(tracks.id, trackId));
  const [t] = await db.select({ v: tracks.currentVersionId }).from(tracks).where(eq(tracks.id, trackId));
  await db
    .update(trackVersions)
    .set({ durationMs: o.durationMs ?? 120_000, previewKey: o.preview === false ? null : `${trackId}/preview.mp3`, waveformKey: `${trackId}/waveform.json` })
    .where(eq(trackVersions.id, t!.v!));
}

/** A track that is on sale unless an override says otherwise. */
async function listed(o: Listed = {}) {
  const t = await makeSellableTrack(db, { sellerOrgId: o.sellerOrgId, clearanceClass: o.cls, status: o.status, paidAds: o.paid, organicSocial: o.organic, priceLevel: o.level });
  await shape(t.trackId, o);
  return t.trackId;
}

const ids = async (s: Partial<DiscoverySearch>) => (await searchTracks(db, search(s))).tracks.map((t) => t.id);
const sorted = (a: string[]) => [...a].sort();

describe('what discovery lists', () => {
  it('lists only tracks that can be bought today', async () => {
    const { genre } = await taxonomy();
    const g = genre.id;
    const ok = await listed({ genreId: g });
    const seller = await makeSeller(db);
    const suspended = await listed({ genreId: g, sellerOrgId: seller.orgId });
    await db.update(sellerProfiles).set({ status: 'suspended' }).where(eq(sellerProfiles.orgId, seller.orgId));
    const hidden = [
      await listed({ genreId: g, status: 'draft' }),
      await listed({ genreId: g, status: 'suspended' }),
      await listed({ genreId: g, status: 'delisted' }),
      await listed({ genreId: g, cls: 'C' }),
      await listed({ genreId: g, preview: false }),
      await listed({ genreId: g, level: null }),
      await listed({ genreId: g, organic: false, paid: false }), // no tier on offer
      suspended,
    ];
    const got = await ids({ genre: [g] });
    expect(got).toEqual([ok]);
    for (const h of hidden) expect(got).not.toContain(h);
  });

  it('returns the expected fixtures for each facet', async () => {
    const { genre, calm, lively } = await taxonomy();
    const g = [genre.id];
    const a = await listed({ genreId: genre.id, moodIds: [calm.id], language: 'hindi', bpm: 80, level: 'L1', durationMs: 30_000 });
    const b = await listed({ genreId: genre.id, moodIds: [lively.id], language: 'punjabi', bpm: 120, level: 'L3', durationMs: 90_000, paid: false });
    const c = await listed({ genreId: genre.id, moodIds: [calm.id, lively.id], language: 'instrumental', bpm: 140, level: 'L5', durationMs: 200_000, organic: false });
    const other = await listed({ genreId: (await taxonomy()).genre.id, moodIds: [calm.id] });

    expect(sorted(await ids({ genre: g }))).toEqual(sorted([a, b, c])); // genre
    expect(sorted(await ids({ genre: g, mood: [calm.id] }))).toEqual(sorted([a, c])); // mood
    expect(sorted(await ids({ genre: g, mood: [calm.id, lively.id] }))).toEqual(sorted([a, b, c])); // any of the moods
    expect(sorted(await ids({ genre: g, lang: ['hindi', 'instrumental'] }))).toEqual(sorted([a, c])); // language, incl. instrumental
    expect(sorted(await ids({ genre: g, bpmMin: 100, bpmMax: 130 }))).toEqual([b]); // BPM range
    expect(sorted(await ids({ genre: g, bpmMin: 100 }))).toEqual(sorted([b, c]));
    expect(sorted(await ids({ genre: g, price: ['L1', 'L5'] }))).toEqual(sorted([a, c])); // price level
    expect(sorted(await ids({ genre: g, durMin: 60, durMax: 120 }))).toEqual([b]); // length
    expect(sorted(await ids({ genre: g, tier: ['paid_ad'] }))).toEqual(sorted([a, c])); // b has no paid use
    expect(sorted(await ids({ genre: g, tier: ['creator'] }))).toEqual(sorted([a, b])); // c has no organic use
    expect(sorted(await ids({ genre: g, tier: ['creator', 'paid_ad'] }))).toEqual([a]); // every picked tier must be on offer
    expect(await ids({ genre: g, lang: ['tamil'] })).toEqual([]);
    expect(await ids({ genre: g, mood: [calm.id] })).not.toContain(other); // facets are ANDed
  });

  it('finds by words: title, artist, a misspelling, a mood or genre name, and ranks relevance, then sales, then recency', async () => {
    const { genre, calm } = await taxonomy();
    const word = `zephyr${rnd()}`;
    const day = (n: number) => new Date(Date.now() - n * 86_400_000);
    const title = await listed({ title: `${word} nights`, genreId: genre.id, at: day(5) });
    const artistOnly = await listed({ title: 'Plain', artist: `${word} Band`, genreId: genre.id, at: day(1) });
    const olderSame = await listed({ title: `${word} nights`, genreId: genre.id, at: day(9) });
    const moody = await listed({ title: 'Quiet', genreId: genre.id, moodIds: [calm.id], at: day(3) });

    const res = await ids({ q: word });
    expect(res.slice(0, 3)).toEqual([title, olderSame, artistOnly]); // title beats artist; equal title: newer first
    expect(await ids({ q: word.slice(0, -1) })).toContain(title); // a prefix as typed
    expect(await ids({ q: word.replace('e', 'a') })).toContain(title); // trigram: one letter off
    expect(await ids({ q: calm.name })).toContain(moody); // mood name
    expect(await ids({ q: genre.name })).toEqual(expect.arrayContaining([title, moody]));

    // equal relevance falls through to sales: a sale lifts the older one above the newer one
    const bought = await sale(db, gw, store, {}); // the sale makes its own track; give it the same words, but older
    const sold = bought.trackId;
    await shape(sold, { title: `${word} sold`, at: day(20) });
    const unsold = await listed({ title: `${word} sold`, at: day(2) });
    expect((await ids({ q: `${word} sold` })).slice(0, 2)).toEqual([sold, unsold]);
    const newest = await ids({ q: `${word} sold`, sort: 'newest' });
    expect(newest.indexOf(unsold)).toBeLessThan(newest.indexOf(sold)); // recency only, whatever the sales
  });

  it('never lets a query break the SQL', async () => {
    for (const q of [`x'); DROP TABLE tracks;--`, '& | ! ( ) :* <->', '"""', '\\', '%', '   ']) {
      await expect(searchTracks(db, search({ q }))).resolves.toBeDefined();
    }
    expect(await db.select({ id: tracks.id }).from(tracks).limit(1)).toHaveLength(1); // the table is still there
  });

  it('pages the results and reports the total', async () => {
    const { genre } = await taxonomy();
    for (let i = 0; i < 26; i++) await listed({ genreId: genre.id });
    const p1 = await searchTracks(db, search({ genre: [genre.id] }));
    const p2 = await searchTracks(db, search({ genre: [genre.id], page: 2 }));
    expect([p1.total, p1.pages, p1.tracks.length, p2.tracks.length]).toEqual([26, 2, 24, 2]);
    expect(p1.tracks.some((t) => p2.tracks.some((u) => u.id === t.id))).toBe(false);
  });

  it('counts each facet with every other filter applied', async () => {
    const { genre, calm, lively } = await taxonomy();
    await listed({ genreId: genre.id, moodIds: [calm.id], language: 'hindi', level: 'L1' });
    await listed({ genreId: genre.id, moodIds: [calm.id], language: 'hindi', level: 'L2' });
    await listed({ genreId: genre.id, moodIds: [lively.id], language: 'tamil', level: 'L2', paid: false });
    const f = await facetCounts(db, search({ genre: [genre.id], lang: ['hindi'] }));
    const count = (list: { value: string; count: number }[], v: string) => list.find((o) => o.value === v)?.count;
    expect(count(f.moods, calm.id)).toBe(2); // moods: within the picked language
    expect(count(f.moods, lively.id)).toBe(0);
    expect(count(f.languages, 'hindi')).toBe(2); // languages ignore their own filter: Tamil is still pickable
    expect(count(f.languages, 'tamil')).toBe(1);
    expect(count(f.priceLevels, 'L1')).toBe(1);
    expect(count(f.priceLevels, 'L2')).toBe(1);
    expect(count(f.tiers, 'paid_ad')).toBe(2);
    expect(count(f.tiers, 'creator')).toBe(2);
    expect(f.genres.find((o) => o.value === genre.id)?.count).toBe(2);
    expect(f.bpm).toMatchObject({ min: expect.any(Number), max: expect.any(Number) });
  });
});

describe('alternative suggestions', () => {
  it('suggest similar tracks, never the track itself or one that is not on sale, and respect the tier', async () => {
    const { genre, calm, lively } = await taxonomy();
    const src = await listed({ genreId: genre.id, moodIds: [calm.id], bpm: 100, level: 'L3' });
    const best = await listed({ genreId: genre.id, moodIds: [calm.id], bpm: 104, level: 'L2' }); // genre + mood + tempo + cheaper
    const sameGenre = await listed({ genreId: genre.id, moodIds: [lively.id], bpm: 160, level: 'L5' });
    const moodOnly = await listed({ genreId: (await taxonomy()).genre.id, moodIds: [calm.id], bpm: 99, level: 'L1' });
    const unrelated = await listed({ genreId: (await taxonomy()).genre.id, moodIds: [lively.id], bpm: 100 });
    const draft = await listed({ genreId: genre.id, moodIds: [calm.id], status: 'draft' });
    const noPaid = await listed({ genreId: genre.id, moodIds: [calm.id], bpm: 170, level: 'L5', paid: false });

    const any = (await suggestTracks(db, src)).map((t) => t.id);
    expect(any[0]).toBe(best);
    expect(any).toEqual(expect.arrayContaining([sameGenre, moodOnly, noPaid]));
    expect(any).not.toContain(src); // never itself
    expect(any).not.toContain(unrelated); // needs the genre or a shared mood
    expect(any).not.toContain(draft); // never something that cannot be bought

    const forAds = (await suggestTracks(db, src, { tier: 'paid_ad' })).map((t) => t.id);
    expect(forAds).not.toContain(noPaid); // no paid-ads license on offer, so no alternative for that tier
    expect(forAds).toContain(best);
    expect(forAds).not.toContain(src);
    expect(await suggestTracks(db, '00000000-0000-7000-8000-000000000000')).toEqual([]);
  });
});
