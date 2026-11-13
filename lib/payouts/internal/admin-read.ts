import { asc, desc, eq, sql } from 'drizzle-orm';
import { organizations, payoutBatches, payouts } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';
import { BUCKETS, createSignedDownloadUrl } from '@/lib/platform/storage';

/** Payout batches, newest period first, with the line count and the net total of each (PLAN §9: Payouts, review lines). */
export async function listPayoutBatches(db: DbOrTx, admin: AdminContext) {
  requirePermission(admin, 'finance');
  return db
    .select({
      id: payoutBatches.id,
      period: payoutBatches.period,
      status: payoutBatches.status,
      approvedAt: payoutBatches.approvedAt,
      lines: sql<number>`count(${payouts.id})::int`,
      netPaise: sql<number>`coalesce(sum(${payouts.netPaise}), 0)::bigint`.mapWith(Number),
    })
    .from(payoutBatches)
    .leftJoin(payouts, eq(payouts.batchId, payoutBatches.id))
    .groupBy(payoutBatches.id)
    .orderBy(desc(payoutBatches.period))
    .limit(60);
}

/** One batch with every seller line, for review before approval and for recording the bank's result. */
export async function getPayoutBatchDetail(db: DbOrTx, admin: AdminContext, batchId: string) {
  requirePermission(admin, 'finance');
  const [batch] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, batchId));
  if (!batch) return null;
  const lines = await db
    .select({ p: payouts, seller: organizations.displayName })
    .from(payouts)
    .innerJoin(organizations, eq(organizations.id, payouts.sellerOrgId))
    .where(eq(payouts.batchId, batchId))
    .orderBy(asc(organizations.displayName));
  return { batch, lines: lines.map((l) => ({ ...l.p, seller: l.seller })) };
}

/**
 * A short-lived attachment link to the batch's bank file, which carries sellers' account numbers: every download is audited.
 * Null when the batch has not been submitted yet.
 */
export async function payoutBankFileUrl(db: DbOrTx, admin: AdminContext, batchId: string, ip?: string | null): Promise<string | null> {
  requirePermission(admin, 'finance');
  const [batch] = await db.select({ key: payoutBatches.railFileKey, period: payoutBatches.period }).from(payoutBatches).where(eq(payoutBatches.id, batchId));
  if (!batch?.key) return null;
  const url = await createSignedDownloadUrl(BUCKETS.documents, batch.key, 120, `payout-bank-file-${batch.period}.csv`);
  await writeAudit(db, { actorUserId: admin.userId, action: 'payout_batch.download_bank_file', entityType: 'payout_batch', entityId: batchId, ip });
  return url; // audited only once a link exists
}
