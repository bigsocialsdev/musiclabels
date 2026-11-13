import { asc, eq, sql } from 'drizzle-orm';
import { disputeEvents, disputes, licenses } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import { getLicenseById } from '@/lib/licensing/server';
import { requestRefund } from '@/lib/orders/server';
import type { DbOrTx } from '@/lib/platform/db';
import { DISPUTE_STATUSES, isDisputeOverdue, type DisputeStatus } from '../index';
import { applyDisputeTransition, notifyOrg } from './transition';

export type DisputeQueueRow = typeof disputes.$inferSelect & { overdue: boolean; licensePublicId: string; trackTitle: string };

/** Disputes queue (PLAN §9): first-action and resolution due dates, overdue filter (derived), oldest due first. */
export async function listDisputes(db: DbOrTx, admin: AdminContext, filter: { status?: DisputeStatus; overdueOnly?: boolean } = {}, now: Date = new Date()): Promise<DisputeQueueRow[]> {
  requirePermission(admin, 'disputes');
  if (filter.status && !DISPUTE_STATUSES.includes(filter.status)) throw new Error('unknown status');
  const rows = await db
    .select({ d: disputes, licensePublicId: licenses.publicId, trackTitle: licenses.trackTitle })
    .from(disputes)
    .innerJoin(licenses, eq(licenses.id, disputes.licenseId))
    .where(filter.status ? eq(disputes.status, filter.status) : undefined)
    .orderBy(sql`coalesce(${disputes.resolutionDueAt}, ${disputes.firstActionDueAt})`)
    .limit(500);
  return rows
    .map((r) => ({ ...r.d, overdue: isDisputeOverdue(r.d, now), licensePublicId: r.licensePublicId, trackTitle: r.trackTitle }))
    .filter((r) => !filter.overdueOnly || r.overdue);
}

/** One dispute with its event log, for the admin page. */
export async function getDisputeDetail(db: DbOrTx, admin: AdminContext, disputeId: string, now: Date = new Date()) {
  requirePermission(admin, 'disputes');
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!d) return null;
  const events = await db.select().from(disputeEvents).where(eq(disputeEvents.disputeId, disputeId)).orderBy(asc(disputeEvents.at));
  return { dispute: d, overdue: isDisputeOverdue(d, now), events };
}

async function buyerOrgOf(db: DbOrTx, licenseId: string) {
  return (await getLicenseById(db, licenseId))!.purchaserOrgId;
}

/** Records the first action (seller contacted, buyer told): open → in_progress. */
export async function recordFirstAction(db: DbOrTx, admin: AdminContext, disputeId: string, input: { note: string }, ip?: string | null) {
  requirePermission(admin, 'disputes');
  const note = input.note.trim();
  if (!note) throw new Error('Describe the action taken');
  return db.transaction(async (tx) => {
    const moved = await applyDisputeTransition(tx, disputeId, 'first_action', { actorUserId: admin.userId, note, ip });
    if (moved.ok) {
      const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId));
      await notifyOrg(tx, await buyerOrgOf(tx, d!.licenseId), 'dispute.first_action', 'Update on your report', `We have taken a first action on your report: ${note}`);
    }
    return moved;
  });
}

export type Resolution = 'released' | 'denied' | 'kit_issued';
const RESOLUTION_EVENT = { released: 'release', denied: 'deny', kit_issued: 'issue_kit' } as const;
const RESOLUTION_COPY: Record<Resolution, string> = {
  released: 'The claim was released.',
  denied: 'We concluded the use was outside the license scope.',
  kit_issued: 'This claim is outside the platform\'s control. Use the dispute kit on your license page to contest it with the platform; a refund can still apply if it is not released within the refund window.',
};

/**
 * Resolves an in-progress dispute: claim released, buyer out of scope (a reason is required; revoking the license is
 * a separate, deliberate admin action), or dispute kit issued for a third-party claim. Final except the kit case.
 */
export async function resolveDispute(db: DbOrTx, admin: AdminContext, disputeId: string, input: { resolution: Resolution; note: string }, ip?: string | null) {
  requirePermission(admin, 'disputes');
  const note = input.note.trim();
  if (!note) throw new Error('A resolution note is required');
  return db.transaction(async (tx) => {
    const moved = await applyDisputeTransition(tx, disputeId, RESOLUTION_EVENT[input.resolution], {
      actorUserId: admin.userId,
      note,
      ip,
      set: { resolution: note, ...(input.resolution === 'kit_issued' ? {} : { closedAt: new Date() }) },
    });
    if (moved.ok) {
      const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId));
      await notifyOrg(tx, await buyerOrgOf(tx, d!.licenseId), `dispute.${input.resolution}`, 'Your report was resolved', `${RESOLUTION_COPY[input.resolution]} ${note}`);
    }
    return moved;
  });
}

/** The claimant is a rightsholder in our catalog: such a claim goes to refund when the window passes unreleased (PLAN §4.6). */
export async function setClaimantCataloged(db: DbOrTx, admin: AdminContext, disputeId: string, cataloged: boolean, ip?: string | null) {
  requirePermission(admin, 'disputes');
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, disputeId)).for('update');
    if (!d) return { ok: false as const, reason: 'not_found' as const };
    await tx.update(disputes).set({ claimantCataloged: cataloged, updatedAt: new Date() }).where(eq(disputes.id, disputeId));
    await tx.insert(disputeEvents).values({ disputeId, kind: 'claimant_cataloged', note: String(cataloged), actorUserId: admin.userId });
    await writeAudit(tx, { actorUserId: admin.userId, action: 'dispute.claimant_cataloged', entityType: 'dispute', entityId: disputeId, before: { claimantCataloged: d.claimantCataloged }, after: { claimantCataloged: cataloged }, ip });
    return { ok: true as const };
  });
}

/**
 * Finance approves the refund for a refund-eligible dispute (PLAN §5.4): the full-order refund with reason
 * `claim_not_released`. One refund per order, so repeating this returns the same refund. The dispute moves to
 * resolved_refunded when the refund completes (the timers sweep notices the refunded order).
 */
export async function requestDisputeRefund(db: DbOrTx, admin: AdminContext, disputeId: string) {
  requirePermission(admin, 'finance');
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!d) return { ok: false as const, reason: 'not_found' as const };
  if (d.status !== 'refund_eligible') return { ok: false as const, reason: 'not_refund_eligible' as const, status: d.status };
  const license = await getLicenseById(db, d.licenseId);
  const refund = await requestRefund(db, admin, license!.orderId, { reason: 'claim_not_released', note: `dispute ${disputeId}` });
  if (!refund.ok) return { ok: false as const, reason: refund.reason };
  return { ok: true as const, refundId: refund.refundId };
}
