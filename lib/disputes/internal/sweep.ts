import { and, eq, isNull, sql } from 'drizzle-orm';
import { disputeEvents, disputes } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { getLicenseById } from '@/lib/licensing/server';
import { enqueueOpsAlert } from '@/lib/notifications/server';
import type { DbOrTx } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import { applyDisputeTransition, notifyOrg } from './transition';

const BATCH = 50;

async function each(db: DbOrTx, ids: string[], work: (tx: DbOrTx, id: string) => Promise<boolean>): Promise<number> {
  let n = 0;
  for (const id of ids) {
    try {
      if (await db.transaction((tx) => work(tx, id))) n++;
    } catch (e) {
      log.error('dispute sweep failed', { disputeId: id, error: errorMessage(e) });
    }
  }
  return n;
}

const idsOf = async (db: DbOrTx, q: ReturnType<typeof sql>) => (await db.execute<{ id: string }>(q)).map((r) => r.id);

/**
 * in_progress (or kit-issued) → refund_eligible once the refund window has passed with the claim unreleased, for a
 * Class A claim or one by a cataloged rightsholder (PLAN §4.6). Finance then approves the refund.
 */
export async function makeRefundEligible(db: DbOrTx, limit = BATCH): Promise<number> {
  const ids = await idsOf(
    db,
    sql`SELECT id FROM disputes
        WHERE status IN ('in_progress','resolved_kit_issued') AND refund_eligible_at <= now()
          AND (clearance_class_at_open = 'A' OR claimant_cataloged)
        ORDER BY refund_eligible_at LIMIT ${limit}`,
  );
  return each(db, ids, async (tx, id) => {
    const moved = await applyDisputeTransition(tx, id, 'make_refund_eligible', { actorUserId: null, note: 'refund window passed without release' });
    if (!moved.ok) return false;
    const [d] = await tx.select().from(disputes).where(eq(disputes.id, id));
    const license = (await getLicenseById(tx, d!.licenseId))!;
    await notifyOrg(tx, license.purchaserOrgId, 'dispute.refund_eligible', 'Your report qualifies for a refund', 'The claim was not released within the refund window. Our finance team will review and process the refund.');
    await enqueueOpsAlert(tx, 'dispute_refund_eligible', 'A dispute is refund-eligible: finance to approve the refund', { disputeId: id, licenseId: d!.licenseId });
    return true;
  });
}

/** One buyer notice and one ops alert the first time a dispute is overdue (PLAN §4.6: overdue itself is derived). */
export async function noticeOverdueDisputes(db: DbOrTx, limit = BATCH): Promise<number> {
  const ids = await idsOf(
    db,
    sql`SELECT id FROM disputes
        WHERE status IN ('open','in_progress') AND overdue_notified_at IS NULL
          AND ((status = 'open' AND first_action_due_at < now()) OR (resolution_due_at IS NOT NULL AND resolution_due_at < now()))
        ORDER BY coalesce(resolution_due_at, first_action_due_at) LIMIT ${limit}`,
  );
  return each(db, ids, async (tx, id) => {
    const [d] = await tx
      .update(disputes)
      .set({ overdueNotifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(disputes.id, id), isNull(disputes.overdueNotifiedAt)))
      .returning();
    if (!d) return false;
    await tx.insert(disputeEvents).values({ disputeId: id, kind: 'overdue_notice', actorUserId: null });
    await writeAudit(tx, { actorUserId: null, action: 'dispute.overdue_notice', entityType: 'dispute', entityId: id, after: { status: d.status } });
    const license = (await getLicenseById(tx, d.licenseId))!;
    await notifyOrg(tx, license.purchaserOrgId, 'dispute.overdue', 'We are late on your report', 'Our response to your report is overdue. We have flagged it to the team and will update you.');
    await enqueueOpsAlert(tx, 'dispute_overdue', 'A dispute is overdue', { disputeId: id, licenseId: d.licenseId, status: d.status });
    return true;
  });
}

/** refund_eligible → resolved_refunded once the order's refund has completed (the refund flow knows nothing of disputes). */
export async function settleRefundedDisputes(db: DbOrTx, limit = BATCH): Promise<number> {
  const ids = await idsOf(
    db,
    sql`SELECT d.id FROM disputes d JOIN licenses l ON l.id = d.license_id JOIN orders o ON o.id = l.order_id
        WHERE d.status = 'refund_eligible' AND o.status = 'refunded' ORDER BY d.created_at LIMIT ${limit}`,
  );
  return each(db, ids, async (tx, id) => {
    const moved = await applyDisputeTransition(tx, id, 'refund_processed', { actorUserId: null, note: 'order refunded', set: { closedAt: new Date() } });
    return moved.ok;
  });
}

/** Everything the timers cron does for disputes, each step isolated from the others' failures. */
export async function sweepDisputes(db: DbOrTx): Promise<{ refundEligible: number; overdueNotices: number; refunded: number }> {
  const step = (name: string, f: () => Promise<number>) =>
    f().catch((e: unknown) => {
      log.error('dispute sweep step failed', { step: name, error: errorMessage(e) });
      return 0;
    });
  return {
    refundEligible: await step('refund_eligible', () => makeRefundEligible(db)),
    overdueNotices: await step('overdue', () => noticeOverdueDisputes(db)),
    refunded: await step('settle_refunded', () => settleRefundedDisputes(db)),
  };
}
