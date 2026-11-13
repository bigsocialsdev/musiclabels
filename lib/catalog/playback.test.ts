import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { trackVersions } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeSellableTrack } from '@/tests/factories';
import { downsamplePeaks, previewUrl, trackPeaks } from './server';

// Signing needs a live Supabase Storage; the rest is real Postgres.
vi.mock('@/lib/platform/storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/platform/storage')>()),
  createSignedDownloadUrl: async (bucket: string, key: string, ttl: number) => `https://storage.test/${bucket}/${key}?ttl=${ttl}`,
}));

afterAll(closeDb);
afterEach(() => vi.unstubAllGlobals());
const db = getDb();

async function playable(over: { status?: string } = {}) {
  const t = await makeSellableTrack(db, { status: over.status });
  await db.update(trackVersions).set({ previewKey: `${t.trackId}/preview.mp3`, waveformKey: `${t.trackId}/waveform.json`, durationMs: 90_000 }).where(eq(trackVersions.id, t.trackVersionId));
  return t;
}

describe('the preview player', () => {
  it('gives a short-lived link to the preview only, never the master', async () => {
    const t = await playable();
    const url = await previewUrl(db, t.trackId);
    expect(url).toBe(`https://storage.test/previews/${t.trackId}/preview.mp3?ttl=600`);
    expect(url).not.toContain('master');
  });

  it('gives nothing for a track that is not published, has no preview, or does not exist', async () => {
    expect(await previewUrl(db, (await playable({ status: 'draft' })).trackId)).toBeNull();
    expect(await previewUrl(db, (await playable({ status: 'suspended' })).trackId)).toBeNull();
    const t = await playable();
    await db.update(trackVersions).set({ previewKey: null }).where(eq(trackVersions.id, t.trackVersionId));
    expect(await previewUrl(db, t.trackId)).toBeNull();
    expect(await previewUrl(db, '00000000-0000-7000-8000-000000000000')).toBeNull();
  });

  it('reads the waveform and reduces it to the bars asked for', async () => {
    const t = await playable();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ peaks: Array.from({ length: 800 }, (_, i) => (i === 400 ? 1 : 0.1)) })));
    const r = await trackPeaks(db, t.trackId, 100);
    expect(r?.durationMs).toBe(90_000);
    expect(r?.peaks).toHaveLength(100);
    expect(Math.max(...r!.peaks)).toBe(1); // the loudest moment survives the reduction
    vi.stubGlobal('fetch', async () => new Response('{"peaks":"nope"}'));
    expect(await trackPeaks(db, t.trackId, 100)).toBeNull(); // malformed file
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    expect(await trackPeaks(db, t.trackId, 100)).toBeNull();
  });

  it('downsamples by maximum and leaves short input alone', () => {
    expect(downsamplePeaks([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
    expect(downsamplePeaks([0.5, 0.6], 10)).toEqual([0.5, 0.6]);
  });
});
