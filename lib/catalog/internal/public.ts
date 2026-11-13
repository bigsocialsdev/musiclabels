import { and, eq } from 'drizzle-orm';
import { tracks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';

/** Public track page lookup: only published tracks exist to the public. */
export async function getPublishedTrack(db: DbOrTx, by: { slug: string } | { id: string }) {
  const [row] = await db
    .select({ id: tracks.id, slug: tracks.slug, title: tracks.title, primaryArtist: tracks.primaryArtist, language: tracks.language, bpm: tracks.bpm, editsAllowed: tracks.editsAllowed })
    .from(tracks)
    .where(and('slug' in by ? eq(tracks.slug, by.slug) : eq(tracks.id, by.id), eq(tracks.status, 'published')));
  return row ?? null;
}
