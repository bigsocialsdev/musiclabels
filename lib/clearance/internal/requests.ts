import { and, eq, sql } from 'drizzle-orm';
import { clearanceRequests } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { getTrackFacts } from '@/lib/catalog/server';
import { getLicenseById, listActiveChannels, listVideos } from '@/lib/licensing/server';
import type { DbOrTx } from '@/lib/platform/db';
import { nextClearanceStatus, type ClearanceEvent, type ClearanceStatus } from '../index';
import { providerFor } from './providers';

export type ClearanceRow = typeof clearanceRequests.$inferSelect;

export type ClearanceTransitionResult =
  | { ok: true; from: ClearanceStatus; to: ClearanceStatus }
  | { ok: false; reason: 'not_found' | 'invalid' | 'conflict'; status?: ClearanceStatus };

type Patch = Partial<
  Pick<ClearanceRow, 'sentAt' | 'dueAt' | 'respondedAt' | 'sellerNote' | 'respondTokenHash' | 'tokenExpiresAt' | 'externalRef' | 'lastError'>
>;

/**
 * Moves a request through the transition table as a compare-and-set `UPDATE ... WHERE id AND status = $from`.
 * PLAN 3.7 gives clearance no event table, so every transition writes an `audit_log` row (system actor when
 * `actorUserId` is null) in the same transaction, like refunds and payouts. Zero rows = someone else won.
 */
export async function applyClearanceTransition(
  db: DbOrTx,
  id: string,
  event: ClearanceEvent,
  opts: { actorUserId: string | null; set?: Patch; note?: string | null; via?: string; ip?: string | null },
): Promise<ClearanceTransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: clearanceRequests.status }).from(clearanceRequests).where(eq(clearanceRequests.id, id));
    if (!current) return { ok: false, reason: 'not_found' } as const;
    const from = current.status as ClearanceStatus;
    const to = nextClearanceStatus(from, event);
    if (!to) return { ok: false, reason: 'invalid', status: from } as const;
    const updated = await tx
      .update(clearanceRequests)
      .set({ ...opts.set, status: to, updatedAt: new Date() })
      .where(and(eq(clearanceRequests.id, id), eq(clearanceRequests.status, from)))
      .returning({ id: clearanceRequests.id });
    if (updated.length === 0) {
      const [now] = await tx.select({ status: clearanceRequests.status }).from(clearanceRequests).where(eq(clearanceRequests.id, id));
      return { ok: false, reason: 'conflict', status: now?.status as ClearanceStatus | undefined } as const;
    }
    await writeAudit(tx, {
      actorUserId: opts.actorUserId,
      action: `clearance.${event}`,
      entityType: 'clearance_request',
      entityId: id,
      before: { status: from },
      after: { status: to, note: opts.note ?? null, via: opts.via ?? (opts.actorUserId ? 'admin' : 'system') },
      ip: opts.ip,
    });
    return { ok: true, from, to } as const;
  });
}

/**
 * Makes sure a license has one clearance request per active channel and per registered video (PLAN 4.5):
 * `not_required` when the track is Class A, `pending` for Class B (the dispatcher sends it). Idempotent and safe
 * to run concurrently (unique per channel and per video), so fulfilment, channel/video registration and the
 * sweep all call it. Class C and unclassified tracks get none: there is nothing a seller can release. Revoked
 * and expired licenses get none either. Returns the number created.
 */
export async function ensureClearanceRequests(tx: DbOrTx, licenseId: string): Promise<number> {
  const license = await getLicenseById(tx, licenseId);
  if (!license || license.effectiveStatus !== 'active') return 0;
  const track = await getTrackFacts(tx, license.trackId);
  if (!track || (track.clearanceClass !== 'A' && track.clearanceClass !== 'B')) return 0;
  const cls = track.clearanceClass;

  const [channels, videos, existing] = await Promise.all([
    listActiveChannels(tx, licenseId),
    listVideos(tx, licenseId),
    tx.select({ channelId: clearanceRequests.licensedChannelId, videoId: clearanceRequests.licensedVideoId }).from(clearanceRequests).where(eq(clearanceRequests.licenseId, licenseId)),
  ]);
  const haveChannel = new Set(existing.map((e) => e.channelId).filter(Boolean));
  const haveVideo = new Set(existing.map((e) => e.videoId).filter(Boolean));
  const status = cls === 'A' ? ('not_required' as const) : ('pending' as const);
  const base = { licenseId, sellerOrgId: track.sellerOrgId, clearanceClass: cls, status, provider: providerFor(cls).id };

  const rows = [
    ...channels.filter((c) => !haveChannel.has(c.id)).map((c) => ({ ...base, scope: 'channel' as const, licensedChannelId: c.id })),
    ...videos.filter((v) => !haveVideo.has(v.id)).map((v) => ({ ...base, scope: 'video' as const, licensedVideoId: v.id })),
  ];
  if (rows.length === 0) return 0;
  const created = await tx.insert(clearanceRequests).values(rows).onConflictDoNothing().returning({ id: clearanceRequests.id });
  return created.length;
}

/** SQL: the request's channel is still on the license (a replaced channel's request is history, not work). */
export const liveTarget = sql`(r.licensed_channel_id is null or exists (select 1 from licensed_channels c where c.id = r.licensed_channel_id and c.removed_at is null))`;
