import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/platform/db';
import type { ObjectStore } from '@/lib/platform/storage';
import { screenVersion, type FingerprintScreener } from '@/lib/screening/server';
import { ingestVersion } from './ingest';
import { applyTransition } from './transition';

const STALE_MINUTES = 10;

export type PipelineDeps = { store?: ObjectStore; screener?: FingerprintScreener };

/**
 * One idempotent pass over a version: ingest, then screening, then (if the track is `submitted` and this is
 * its latest version) hand the track to the review queue. Every step claims its own row, so the `after()`
 * run, a second click and the cron sweep can overlap safely.
 */
export async function processVersion(versionId: string, deps: PipelineDeps = {}) {
  const ingest = await ingestVersion(versionId, deps.store);
  const screening = ingest === 'failed' ? 'not_ready' : await screenVersion(versionId, deps);
  const moved = await moveToReviewIfDone(versionId);
  return { ingest, screening, movedToReview: moved };
}

/** `submitted` → `in_review` once the latest version is ingested and its screening has finished (clean, match or unavailable). */
export async function moveToReviewIfDone(versionId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db.execute<{ track_id: string }>(sql`
    SELECT t.id AS track_id
    FROM track_versions v
    JOIN tracks t ON t.id = v.track_id
    JOIN screenings s ON s.track_version_id = v.id
    WHERE v.id = ${versionId} AND t.status = 'submitted' AND v.ingest_status = 'ready'
      AND s.status IN ('clean', 'match', 'unavailable')
      AND v.version_no = (SELECT max(version_no) FROM track_versions WHERE track_id = v.track_id)`);
  if (!row) return false;
  const result = await applyTransition(db, row.track_id, 'ingest_screen_done', null);
  return result.ok;
}

/** Cron backstop: versions with unfinished ingest or screening, or a submitted track not yet moved on. Oldest first. */
export async function sweepCatalog(limit = 5, deps: PipelineDeps = {}) {
  const rows = await getDb().execute<{ id: string }>(sql`
    SELECT v.id
    FROM track_versions v
    JOIN tracks t ON t.id = v.track_id
    LEFT JOIN screenings s ON s.track_version_id = v.id
    WHERE v.version_no = (SELECT max(version_no) FROM track_versions WHERE track_id = v.track_id)
      AND t.status IN ('draft', 'submitted')
      AND (
        v.ingest_status = 'pending'
        OR (v.ingest_status = 'processing' AND v.claimed_at < now() - make_interval(mins => ${STALE_MINUTES}))
        OR (v.ingest_status = 'ready' AND (
              s.id IS NULL
              OR s.status = 'error'
              OR (s.status = 'queued' AND s.created_at < now() - make_interval(mins => ${STALE_MINUTES}))
              OR (t.status = 'submitted' AND s.status IN ('clean', 'match', 'unavailable'))))
      )
    ORDER BY v.created_at
    LIMIT ${limit}`);
  let processed = 0;
  for (const { id } of rows) {
    await processVersion(id, deps);
    processed++;
  }
  return processed;
}
