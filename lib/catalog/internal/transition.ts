import { and, eq } from 'drizzle-orm';
import { trackEvents, tracks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { nextStatus, type TrackEvent, type TrackStatus } from '../index';

export type TransitionResult =
  | { ok: true; from: TrackStatus; to: TrackStatus }
  | { ok: false; reason: 'not_found' | 'invalid' | 'conflict'; status?: TrackStatus };

type Patch = Partial<
  Pick<typeof tracks.$inferInsert, 'priceLevel' | 'clearanceClass' | 'currentVersionId' | 'publishedAt' | 'rejectionReason'>
>;

/**
 * Moves a track through the transition table as a compare-and-set
 * `UPDATE ... WHERE id = $1 AND status = $from`, and writes the event row with the same handle.
 * Run inside the caller's transaction so audit/outbox rows commit with it. Zero rows updated means
 * another actor moved the track first: return its current status and do nothing.
 */
export async function applyTransition(
  db: DbOrTx,
  trackId: string,
  event: TrackEvent,
  actorUserId: string | null,
  opts: { reason?: string; set?: Patch } = {},
): Promise<TransitionResult> {
  const [current] = await db.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, trackId));
  if (!current) return { ok: false, reason: 'not_found' };
  const from = current.status as TrackStatus;
  const to = nextStatus(from, event);
  if (!to) return { ok: false, reason: 'invalid', status: from };

  const updated = await db
    .update(tracks)
    .set({ ...opts.set, status: to, updatedAt: new Date() })
    .where(and(eq(tracks.id, trackId), eq(tracks.status, from)))
    .returning({ id: tracks.id });
  if (updated.length === 0) {
    const [now] = await db.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, trackId));
    return { ok: false, reason: 'conflict', status: now?.status as TrackStatus | undefined };
  }
  await db.insert(trackEvents).values({ trackId, fromStatus: from, toStatus: to, event, actorUserId, reason: opts.reason ?? null });
  return { ok: true, from, to };
}
