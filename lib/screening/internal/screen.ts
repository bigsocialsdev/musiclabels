import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import { BUCKETS, supabaseObjectStore, type ObjectStore } from '@/lib/platform/storage';
import type { FingerprintScreener, ScreenMatch, ScreenResult } from '../index';
import { acrCloudFromEnv, unavailableScreener } from './acrcloud';

const STALE_MINUTES = 10;

export type ScreenOutcome = ScreenResult['status'] | 'skipped' | 'not_ready';

/** Same audio under a different track is a duplicate (cross-seller or re-upload), caught without any vendor. */
async function internalDuplicates(versionId: string): Promise<ScreenMatch[]> {
  const rows = await getDb().execute<{ title: string; artist: string }>(sql`
    SELECT t.title, t.primary_artist AS artist
    FROM track_versions me
    JOIN track_versions other ON other.master_sha256 = me.master_sha256 AND other.id <> me.id
    JOIN tracks t ON t.id = other.track_id
    WHERE me.id = ${versionId} AND me.master_sha256 IS NOT NULL
      AND other.track_id <> me.track_id AND t.status <> 'delisted'`);
  return rows.map((r) => ({ title: r.title, artist: r.artist, source: 'internal_duplicate' as const }));
}

/**
 * Idempotent `screen` handler for one ingested version. The unique screenings row is the claim: a
 * concurrent run, or a finished screening, is skipped; an earlier `error` (or a stale `queued`) is retried.
 * Without a configured vendor the result is `unavailable` and the admin claim probe is the only check (F3).
 */
export async function screenVersion(
  versionId: string,
  deps: { screener?: FingerprintScreener; store?: ObjectStore } = {},
): Promise<ScreenOutcome> {
  const db = getDb();
  const [version] = await db.execute<{ ingest_status: string; mp3: string | null; duration_ms: number | null }>(sql`
    SELECT ingest_status, mp3_derivative_key AS mp3, duration_ms FROM track_versions WHERE id = ${versionId}`);
  if (!version || version.ingest_status !== 'ready' || !version.mp3 || !version.duration_ms) return 'not_ready';

  const screener = deps.screener ?? acrCloudFromEnv() ?? unavailableScreener;
  const store = deps.store ?? supabaseObjectStore;

  const claimed = await db.execute<{ id: string }>(sql`
    INSERT INTO screenings (id, track_version_id, provider, status)
    VALUES (${crypto.randomUUID()}, ${versionId}, ${screener.id}, 'queued')
    ON CONFLICT (track_version_id) DO UPDATE SET status = 'queued', provider = ${screener.id}, created_at = now()
      WHERE screenings.status = 'error'
         OR (screenings.status = 'queued' AND screenings.created_at < now() - make_interval(mins => ${STALE_MINUTES}))
    RETURNING id`);
  if (!claimed[0]) return 'skipped';

  const work = await mkdtemp(path.join(tmpdir(), 'mrm-screen-'));
  let result: ScreenResult;
  try {
    const duplicates = await internalDuplicates(versionId);
    let vendor: ScreenResult;
    try {
      const audio = path.join(work, 'audio.mp3');
      await store.downloadToFile(BUCKETS.masters, version.mp3, audio);
      vendor = await screener.screen({ audioFile: audio, durationMs: version.duration_ms });
    } catch (e) {
      log.error('screening failed', { versionId, error: errorMessage(e) });
      vendor = { status: 'error', matches: [] };
    }
    const matches = [...duplicates, ...vendor.matches];
    result = { status: matches.length ? 'match' : vendor.status, matches };
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  await db.execute(sql`
    UPDATE screenings SET status = ${result.status}, matches = ${JSON.stringify(result.matches)}::jsonb
    WHERE id = ${claimed[0].id} AND status = 'queued'`);
  return result.status;
}

