import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { licenses, refunds } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';

export type Refund = typeof refunds.$inferSelect;
export const REFUND_REASONS = ['claim_not_released', 'platform_error', 'invalid_rights', 'unsellable_at_fulfilment', 'admin_goodwill'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

const STALE_CLAIM_MINUTES = 10;
/** Processing, but unclaimed or claimed by a run that has evidently died. */
const staleProcessing = () =>
  and(eq(refunds.status, 'processing'), or(isNull(refunds.claimedAt), lt(refunds.claimedAt, sql`now() - make_interval(mins => ${STALE_CLAIM_MINUTES})`)));

/** Refund status changes are system actions: each writes an audit row with the change (CLAUDE.md). */
const auditRefund = (db: DbOrTx, id: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
  writeAudit(db, { actorUserId: null, action: `refund.${to}`, entityType: 'refund', entityId: id, before: { status: from }, after: { status: to, ...extra } });

/** One refund per order (unique). The amount is the order total; the DB rejects anything else. */
export async function createRefundRequest(
  db: DbOrTx,
  input: { orderId: string; reason: RefundReason; amountPaise: number; requestedBy: string | null; note?: string | null },
): Promise<Refund> {
  const [row] = await db
    .insert(refunds)
    .values({ orderId: input.orderId, reason: input.reason, amountPaise: input.amountPaise, requestedBy: input.requestedBy, note: input.note ?? null })
    .onConflictDoNothing({ target: refunds.orderId })
    .returning();
  if (row) {
    await writeAudit(db, { actorUserId: input.requestedBy, action: 'refund.requested', entityType: 'refund', entityId: row.id, after: { status: 'requested', reason: input.reason, amountPaise: input.amountPaise, orderId: input.orderId } });
    return row;
  }
  const [existing] = await db.select().from(refunds).where(eq(refunds.orderId, input.orderId));
  return existing!;
}

export async function getRefund(db: DbOrTx, id: string): Promise<Refund | null> {
  const [row] = await db.select().from(refunds).where(eq(refunds.id, id));
  return row ?? null;
}

export async function findRefundByGateway(db: DbOrTx, gatewayRefundId: string, receipt: string | null): Promise<Refund | null> {
  const [byId] = await db.select().from(refunds).where(eq(refunds.gatewayRefundId, gatewayRefundId));
  if (byId) return byId;
  if (!receipt || !/^[0-9a-f-]{36}$/.test(receipt)) return null;
  const [byReceipt] = await db.select().from(refunds).where(eq(refunds.id, receipt));
  return byReceipt ?? null;
}

/** Compare-and-set claim: requested or failed (retry), or processing left by a run that died. */
export async function claimRefund(db: DbOrTx, id: string): Promise<Refund | null> {
  return db.transaction(async (tx) => {
    const [prev] = await tx.select({ status: refunds.status }).from(refunds).where(eq(refunds.id, id)).for('update');
    const [row] = await tx
      .update(refunds)
      .set({ status: 'processing', claimedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(refunds.id, id), or(inArray(refunds.status, ['requested', 'failed']), staleProcessing())))
      .returning();
    if (row && prev!.status !== 'processing') await auditRefund(tx, id, prev!.status, 'processing');
    return row ?? null;
  });
}

/** The Razorpay refund currently carrying this row's receipt (a retry after a failed attempt replaces it). */
export async function setGatewayRefundId(db: DbOrTx, id: string, gatewayRefundId: string): Promise<void> {
  await db.update(refunds).set({ gatewayRefundId, updatedAt: new Date() }).where(and(eq(refunds.id, id), eq(refunds.status, 'processing')));
}

/** Leaves the row processing but releases the claim, so the next sweep retries it. */
export async function releaseRefund(db: DbOrTx, id: string, error: string | null): Promise<void> {
  await db.update(refunds).set({ claimedAt: null, lastError: error, updatedAt: new Date() }).where(and(eq(refunds.id, id), eq(refunds.status, 'processing')));
}

/** processing → processed (once). Returns false if another run already finished it. */
export async function markRefundProcessed(db: DbOrTx, id: string): Promise<boolean> {
  const rows = await db
    .update(refunds)
    .set({ status: 'processed', processedAt: new Date(), claimedAt: null, lastError: null, updatedAt: new Date() })
    .where(and(eq(refunds.id, id), eq(refunds.status, 'processing')))
    .returning({ id: refunds.id });
  if (rows.length) await auditRefund(db, id, 'processing', 'processed');
  return rows.length > 0;
}

export async function markRefundFailed(db: DbOrTx, id: string, error: string): Promise<boolean> {
  const rows = await db
    .update(refunds)
    .set({ status: 'failed', claimedAt: null, lastError: error.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(refunds.id, id), eq(refunds.status, 'processing')))
    .returning({ id: refunds.id });
  if (rows.length) await auditRefund(db, id, 'processing', 'failed', { error: error.slice(0, 300) });
  return rows.length > 0;
}

/** Sweep input: refunds never sent, or processing and unclaimed/stale (awaiting Razorpay or a dead run). */
export async function listRefundsToSweep(db: DbOrTx, limit = 50): Promise<string[]> {
  const rows = await db
    .select({ id: refunds.id })
    .from(refunds)
    .where(
      or(
        eq(refunds.status, 'requested'),
        staleProcessing(),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Refunds for the finance screen, newest first, with the license each one reverses (none for an order that never reached a license). */
export async function listRefunds(db: DbOrTx, admin: AdminContext, status?: Refund['status']) {
  requirePermission(admin, 'finance');
  return db
    .select({ refund: refunds, licensePublicId: licenses.publicId, trackTitle: licenses.trackTitle })
    .from(refunds)
    .leftJoin(licenses, eq(licenses.orderId, refunds.orderId))
    .where(status ? eq(refunds.status, status) : undefined)
    .orderBy(desc(refunds.createdAt))
    .limit(500);
}

/**
 * Finance re-sends a refund that failed or was never sent. Only the audit row (who asked) is written here; the caller
 * kicks `executeRefund`, whose claim is the compare-and-set that keeps a double click to one send.
 */
export async function retryRefund(db: DbOrTx, admin: AdminContext, refundId: string, ip?: string | null): Promise<{ ok: boolean }> {
  requirePermission(admin, 'finance');
  return db.transaction(async (tx) => {
    const [r] = await tx.select({ status: refunds.status }).from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!r || (r.status !== 'requested' && r.status !== 'failed')) return { ok: false };
    await writeAudit(tx, { actorUserId: admin.userId, action: 'refund.retry', entityType: 'refund', entityId: refundId, before: { status: r.status }, after: { status: r.status }, ip });
    return { ok: true };
  });
}
