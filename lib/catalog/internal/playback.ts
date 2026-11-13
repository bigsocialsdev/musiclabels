import { and, eq } from 'drizzle-orm';
import { trackVersions, tracks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { BUCKETS, createSignedDownloadUrl } from '@/lib/platform/storage';
import { downsamplePeaks } from '../index';

/** The preview of a published track's current version (the audible-watermarked 128k file), or null if there is none. */
async function playableKeys(db: DbOrTx, trackId: string) {
  const [row] = await db
    .select({ previewKey: trackVersions.previewKey, waveformKey: trackVersions.waveformKey, durationMs: trackVersions.durationMs })
    .from(tracks)
    .innerJoin(trackVersions, eq(trackVersions.id, tracks.currentVersionId))
    .where(and(eq(tracks.id, trackId), eq(tracks.status, 'published'), eq(trackVersions.ingestStatus, 'ready')));
  return row?.previewKey ? row : null;
}

/** A short-lived link to the preview for the player. Masters and clean files are never reachable from here. */
export async function previewUrl(db: DbOrTx, trackId: string): Promise<string | null> {
  const k = await playableKeys(db, trackId);
  return k ? createSignedDownloadUrl(BUCKETS.previews, k.previewKey!, 600) : null;
}

/** Waveform bars (0..1) for a published track, reduced to `n` bars. */
export async function trackPeaks(db: DbOrTx, trackId: string, n: number): Promise<{ peaks: number[]; durationMs: number } | null> {
  const k = await playableKeys(db, trackId);
  if (!k?.waveformKey) return null;
  const res = await fetch(await createSignedDownloadUrl(BUCKETS.previews, k.waveformKey, 60));
  if (!res.ok) return null;
  const body = (await res.json()) as { peaks?: unknown };
  if (!Array.isArray(body.peaks) || !body.peaks.every((p) => typeof p === 'number')) return null;
  return { peaks: downsamplePeaks(body.peaks as number[], n), durationMs: k.durationMs ?? 0 };
}
