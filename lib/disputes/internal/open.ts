import { and, asc, desc, eq } from 'drizzle-orm';
import { disputeEvents, disputes } from '@/db/schema';
import { getTrackFacts } from '@/lib/catalog/server';
import { getLicenseForBuyer, type BuyerActor, type Result } from '@/lib/licensing/server';
import { enqueueEmail } from '@/lib/notifications/server';
import { addBusinessDays } from '@/lib/platform/business-days';
import type { DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { consume } from '@/lib/platform/ratelimit';
import { getSellerStanding } from '@/lib/sellers/server';
import { RESOLUTION_TARGET_HOURS, disputeInputSchema, type DisputeInput } from '../index';
import { notifyOrg } from './transition';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const refundWindowDays = () => getEnv().CLAIM_RELEASE_REFUND_WINDOW_DAYS;

/**
 * A buyer reports a claim or strike against a use of a license they hold (PLAN §5.4 step 1). Timers are fixed
 * now and never change: first action in 1 business day for every dispute, a 48-hour resolution target only when
 * the track is Class A or B at this moment (a track since reclassified C gets none: no seller contract backs it),
 * and the refund window from the configured days. The same claim reported again while open is not a second dispute.
 * Emails the buyer and the seller's ops contact in the same transaction.
 */
export async function openDispute(db: DbOrTx, actor: BuyerActor, licenseId: string, raw: DisputeInput, now: Date = new Date()): Promise<Result<{ disputeId: string }>> {
  const input = disputeInputSchema.parse(raw);
  const held = await getLicenseForBuyer(db, actor, licenseId);
  if (!held) return { ok: false, issues: ['not_found'] };
  if (held.license.effectiveStatus === 'revoked') return { ok: false, issues: ['license_revoked'] };
  if (!(await consume(`dispute-open:${actor.userId}`, { capacity: 10, refillPerSecond: 1 / 60 }))) return { ok: false, issues: ['rate_limited'] };

  const track = await getTrackFacts(db, held.license.trackId);
  if (!track) return { ok: false, issues: ['not_found'] };
  const cls = track.clearanceClass;
  const backed = cls === 'A' || cls === 'B';

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(disputes)
      .values({
        licenseId,
        openedBy: actor.userId,
        videoUrl: input.videoUrl,
        platform: input.platform,
        disputeType: input.disputeType,
        claimantName: input.claimantName,
        clearanceClassAtOpen: cls,
        firstActionDueAt: addBusinessDays(now, 1),
        resolutionDueAt: backed ? new Date(now.getTime() + RESOLUTION_TARGET_HOURS * HOUR_MS) : null,
        refundEligibleAt: new Date(now.getTime() + refundWindowDays() * DAY_MS),
      })
      .onConflictDoNothing()
      .returning({ id: disputes.id });
    if (!row) return { ok: false as const, issues: ['duplicate_open_dispute'] };
    await tx.insert(disputeEvents).values({ disputeId: row.id, kind: 'opened', note: `${input.disputeType} by ${input.claimantName} on ${input.platform}`, actorUserId: actor.userId });

    await notifyOrg(tx, actor.orgId, 'dispute.opened', `We received your report for “${track.title}”`, `We have your report about ${input.videoUrl}. We will record a first action within one business day. Claims by third parties run on the platform's own clock and we cannot promise an outcome.`);
    const standing = await getSellerStanding(tx, track.sellerOrgId);
    if (standing?.opsContactEmail) {
      await enqueueEmail(tx, {
        kind: 'dispute.opened_seller',
        to: standing.opsContactEmail,
        template: 'dispute_update',
        payload: { subject: `A buyer reported a claim on “${track.title}”`, message: `${input.claimantName} claimed ${input.videoUrl} (${input.disputeType}, ${input.platform}). Please release it with the platform and tell the platform's support team.` },
      });
    }
    return { ok: true as const, value: { disputeId: row.id } };
  });
}

/** A buyer's disputes on one license, newest first; another org's license (or a non-member) gets nothing. */
export async function listBuyerDisputes(db: DbOrTx, actor: BuyerActor, licenseId: string) {
  if (!(await getLicenseForBuyer(db, actor, licenseId))) return [];
  // Only what the buyer reported and the outcome: internal flags (claimant_cataloged, notice bookkeeping) stay with ops.
  return db
    .select({
      id: disputes.id,
      videoUrl: disputes.videoUrl,
      platform: disputes.platform,
      disputeType: disputes.disputeType,
      claimantName: disputes.claimantName,
      status: disputes.status,
      firstActionDueAt: disputes.firstActionDueAt,
      resolutionDueAt: disputes.resolutionDueAt,
      refundEligibleAt: disputes.refundEligibleAt,
      resolution: disputes.resolution,
      createdAt: disputes.createdAt,
      closedAt: disputes.closedAt,
    })
    .from(disputes)
    .where(eq(disputes.licenseId, licenseId))
    .orderBy(desc(disputes.createdAt));
}

/** The event log of a dispute the buyer opened under their org's license. */
export async function getBuyerDisputeEvents(db: DbOrTx, actor: BuyerActor, disputeId: string) {
  const [d] = await db.select({ licenseId: disputes.licenseId }).from(disputes).where(eq(disputes.id, disputeId));
  if (!d || !(await getLicenseForBuyer(db, actor, d.licenseId))) return null;
  return db
    .select({ kind: disputeEvents.kind, at: disputeEvents.at })
    .from(disputeEvents)
    .where(and(eq(disputeEvents.disputeId, disputeId)))
    .orderBy(asc(disputeEvents.at));
}
