import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { trackVersions } from '@/db/schema';
import { getDb } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import { BUCKETS, ObjectNotFoundError, supabaseObjectStore, type ObjectStore } from '@/lib/platform/storage';
import { MediaRejectedError, probeAudio, renderMp3, renderPreview, sha256File, waveformPeaks } from './media';

const STALE_CLAIM_MINUTES = 10;
/** PLAN 5.1: masters are at most 200 MB (the bucket limit enforces it at upload; re-checked here). */
export const MAX_MASTER_BYTES = 200 * 1024 * 1024;
const GENERIC_FAILURE = 'We could not process this file. Please upload it again or contact support.';

export type IngestOutcome = 'ready' | 'failed' | 'skipped';

/** Where a version's derived files live, from its master key (`<org>/<track>/<version>.<ext>`). */
export function derivedKeys(masterKey: string) {
  const base = masterKey.replace(/\.[^./]+$/, '');
  return {
    preview: `${base}/preview.mp3`,
    waveform: `${base}/waveform.json`,
    mp3: `${base}.320.mp3`,
  };
}

/**
 * Idempotent `ingest` handler for one track version. Claims the row (pending, or processing but stale)
 * with a compare-and-set, stages files in a temp dir, and records `ready` or `failed` with a
 * seller-visible reason. Re-running after a crash redoes everything; uploads overwrite.
 */
export async function ingestVersion(versionId: string, store: ObjectStore = supabaseObjectStore): Promise<IngestOutcome> {
  const db = getDb();
  const claimed = await db.execute<{ id: string; master_key: string }>(sql`
    UPDATE track_versions SET ingest_status = 'processing', claimed_at = now(), ingest_error = NULL
    WHERE id = ${versionId}
      AND (ingest_status = 'pending'
           OR (ingest_status = 'processing' AND claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})))
    RETURNING id, master_key`);
  const row = claimed[0];
  if (!row) return 'skipped';

  const work = await mkdtemp(path.join(tmpdir(), 'mrm-ingest-'));
  try {
    const ext = path.extname(row.master_key) || '.bin';
    const master = path.join(work, `master${ext}`);
    try {
      await store.downloadToFile(BUCKETS.masters, row.master_key, master);
    } catch (e) {
      if (e instanceof ObjectNotFoundError) throw new MediaRejectedError('The uploaded file was not found. Please upload it again.');
      throw e;
    }

    if ((await stat(master)).size > MAX_MASTER_BYTES) throw new MediaRejectedError('The file is larger than 200 MB');
    const probe = await probeAudio(master);
    const sha256 = await sha256File(master);
    const keys = derivedKeys(row.master_key);

    const previewFile = path.join(work, 'preview.mp3');
    const mp3File = path.join(work, 'master320.mp3');
    await renderPreview(master, previewFile);
    await renderMp3(master, mp3File);
    const peaks = await waveformPeaks(master, probe.durationMs);

    await store.upload(BUCKETS.previews, keys.preview, await readFile(previewFile), 'audio/mpeg');
    await store.upload(BUCKETS.previews, keys.waveform, Buffer.from(JSON.stringify({ peaks })), 'application/json');
    await store.upload(BUCKETS.masters, keys.mp3, await readFile(mp3File), 'audio/mpeg');
    log.info('ingest outputs', { versionId, previewBytes: (await stat(previewFile)).size, mp3Bytes: (await stat(mp3File)).size });

    const done = await db.execute(sql`
      UPDATE track_versions SET
        ingest_status = 'ready', ingest_error = NULL, master_sha256 = ${sha256}, master_format = ${probe.format},
        duration_ms = ${probe.durationMs}, sample_rate = ${probe.sampleRate},
        preview_key = ${keys.preview}, preview_download_key = ${keys.preview},
        mp3_derivative_key = ${keys.mp3}, waveform_key = ${keys.waveform}
      WHERE id = ${versionId} AND ingest_status = 'processing' RETURNING id`);
    return done.length > 0 ? 'ready' : 'skipped';
  } catch (e) {
    const reason = e instanceof MediaRejectedError ? e.message : GENERIC_FAILURE;
    if (!(e instanceof MediaRejectedError)) log.error('ingest failed', { versionId, error: errorMessage(e) });
    await db.update(trackVersions).set({ ingestStatus: 'failed', ingestError: reason }).where(sql`${trackVersions.id} = ${versionId} AND ${trackVersions.ingestStatus} = 'processing'`);
    return 'failed';
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
