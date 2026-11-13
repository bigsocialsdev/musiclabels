import { and, eq } from 'drizzle-orm';
import { trackVersions, tracks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { BUCKETS, createSignedDownloadUrl } from '@/lib/platform/storage';
import { downsamplePeaks } from '../index';
import { getSellableTrack } from './search';

/** The preview and waveform keys of a track that is on sale (same rule as the listing), or null. The preview is the audible-watermarked 128k file. */
async function playableKeys(db: DbOrTx, trackId: string) {
  if (!(await getSellableTrack(db, { id: trackId }))) return null;
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

async function fetchPeaks(key: string): Promise<{ peaks?: unknown } | null> {
  try {
    const res = await fetch(await createSignedDownloadUrl(BUCKETS.previews, key, 60));
    return res.ok ? ((await res.json()) as { peaks?: unknown }) : null;
  } catch {
    return null;
  }
}

/** Waveform bars (0..1) for a published track, reduced to `n` bars. */
export async function trackPeaks(db: DbOrTx, trackId: string, n: number): Promise<{ peaks: number[]; durationMs: number } | null> {
  const k = await playableKeys(db, trackId);
  if (!k?.waveformKey) return null;
  // A storage hiccup must not break the page: the strips fall back to a flat line.
  const body = await fetchPeaks(k.waveformKey);
  if (!body) return null;
  if (!Array.isArray(body.peaks) || !body.peaks.every((p) => typeof p === 'number')) return null;
  return { peaks: downsamplePeaks(body.peaks as number[], n), durationMs: k.durationMs ?? 0 };
}
