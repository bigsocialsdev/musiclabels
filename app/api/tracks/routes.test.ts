import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { trackVersions } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { setupCommerce } from '@/tests/commerce';
import { makeSellableTrack } from '@/tests/factories';
import { GET as preview } from './[id]/preview/route';
import { GET as waveform } from './[id]/waveform/route';

// Signing needs a live Supabase Storage; the rest is real Postgres.
vi.mock('@/lib/platform/storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/platform/storage')>()),
  createSignedDownloadUrl: async (bucket: string, key: string, ttl: number) => `https://storage.test/${bucket}/${key}?ttl=${ttl}`,
}));

afterAll(closeDb);
afterEach(() => vi.unstubAllGlobals());
const db = getDb();
// A track is on sale only with an active price book; do not rely on an earlier test file having made one.
beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (path: string, ip: string) => new Request(`http://localhost${path}`, { headers: { 'x-real-ip': ip } });
const ipOf = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function playable() {
  const t = await makeSellableTrack(db);
  await db.update(trackVersions).set({ previewKey: `${t.trackId}/preview.mp3`, waveformKey: `${t.trackId}/waveform.json`, durationMs: 90_000 }).where(eq(trackVersions.id, t.trackVersionId));
  return t.trackId;
}

describe('GET /api/tracks/[id]/preview', () => {
  it('redirects a published track to its signed preview, briefly cached and never public', async () => {
    const id = await playable();
    const res = await preview(req(`/api/tracks/${id}/preview`, ipOf()), ctx(id));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`https://storage.test/previews/${id}/preview.mp3?ttl=600`);
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });

  it('is 404 for a malformed id or a track that is not published', async () => {
    const ip = ipOf();
    expect((await preview(req('/x', ip), ctx('not-a-uuid'))).status).toBe(404);
    expect((await preview(req('/x', ip), ctx('00000000-0000-7000-8000-000000000000'))).status).toBe(404);
    const draft = await makeSellableTrack(db, { status: 'draft' });
    expect((await preview(req('/x', ip), ctx(draft.trackId))).status).toBe(404);
  });

  it('throttles one address after its burst', async () => {
    const id = await playable();
    const ip = ipOf();
    const codes: number[] = [];
    for (let i = 0; i < 62; i++) codes.push((await preview(req('/x', ip), ctx(id))).status);
    expect(codes.slice(0, 60).every((c) => c === 302)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    // another address is unaffected
    expect((await preview(req('/x', ipOf()), ctx(id))).status).toBe(302);
  });
});

describe('GET /api/tracks/[id]/waveform', () => {
  it('returns the reduced bars with the duration, cacheable', async () => {
    const id = await playable();
    vi.stubGlobal('fetch', async () => Response.json({ peaks: Array.from({ length: 800 }, (_, i) => (i % 100) / 100) }));
    const res = await waveform(req(`/api/tracks/${id}/waveform?n=50`, ipOf()), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('public');
    const body = (await res.json()) as { peaks: number[]; durationMs: number };
    expect(body.peaks).toHaveLength(50);
    expect(body.durationMs).toBe(90_000);
  });

  it('is 404 for a bad id, an unknown track or missing peaks, and clamps a silly n', async () => {
    const ip = ipOf();
    expect((await waveform(req('/x', ip), ctx('nope'))).status).toBe(404);
    expect((await waveform(req('/x', ip), ctx('00000000-0000-7000-8000-000000000000'))).status).toBe(404);
    const id = await playable();
    vi.stubGlobal('fetch', async () => new Response('gone', { status: 404 }));
    expect((await waveform(req('/x', ip), ctx(id))).status).toBe(404);
    vi.stubGlobal('fetch', async () => Response.json({ peaks: Array.from({ length: 800 }, () => 0.5) }));
    const big = (await (await waveform(req(`/api/tracks/${id}/waveform?n=99999`, ip), ctx(id))).json()) as { peaks: number[] };
    expect(big.peaks).toHaveLength(120); // out of range falls back to the default
  });
});
