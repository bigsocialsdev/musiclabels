import { and, eq } from 'drizzle-orm';
import { trackEvents, tracks } from '@/db/schema';
import { writeAudit, type AuditEntry } from '@/lib/audit/server';
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
 * `UPDATE ... WHERE id = $1 AND status = $from`, and writes the event row (and, when `audit` is given, the
 * audit row) with it. The three writes always share one transaction: this opens its own, which becomes a
 * savepoint when the caller already has one. Zero rows updated means another actor moved the track first:
 * return its current status and do nothing.
 */
export async function applyTransition(
  db: DbOrTx,
  trackId: string,
  event: TrackEvent,
  actorUserId: string | null,
  opts: { reason?: string; set?: Patch; audit?: Omit<AuditEntry, 'actorUserId' | 'entityType' | 'entityId'> } = {},
): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, trackId));
    if (!current) return { ok: false, reason: 'not_found' } as const;
    const from = current.status as TrackStatus;
    const to = nextStatus(from, event);
    if (!to) return { ok: false, reason: 'invalid', status: from } as const;

    const updated = await tx
      .update(tracks)
      .set({ ...opts.set, status: to, updatedAt: new Date() })
      .where(and(eq(tracks.id, trackId), eq(tracks.status, from)))
      .returning({ id: tracks.id });
    if (updated.length === 0) {
      const [now] = await tx.select({ status: tracks.status }).from(tracks).where(eq(tracks.id, trackId));
      return { ok: false, reason: 'conflict', status: now?.status as TrackStatus | undefined } as const;
    }
    await tx.insert(trackEvents).values({ trackId, fromStatus: from, toStatus: to, event, actorUserId, reason: opts.reason ?? null });
    if (opts.audit) await writeAudit(tx, { ...opts.audit, actorUserId, entityType: 'track', entityId: trackId });
    return { ok: true, from, to } as const;
  });
}
