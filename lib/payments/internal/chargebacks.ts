import { and, eq } from 'drizzle-orm';
import { chargebacks } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import type { DbOrTx } from '@/lib/platform/db';

/** Idempotent on Razorpay's dispute id. Returns whether this call created the row. */
export async function recordChargeback(db: DbOrTx, input: { orderId: string; gatewayDisputeId: string; amountPaise: number }): Promise<boolean> {
  const rows = await db.insert(chargebacks).values(input).onConflictDoNothing({ target: chargebacks.gatewayDisputeId }).returning({ id: chargebacks.id });
  if (rows.length) {
    await writeAudit(db, { actorUserId: null, action: 'chargeback.open', entityType: 'chargeback', entityId: rows[0]!.id, after: { status: 'open', ...input } });
  }
  return rows.length > 0;
}

/** open → won | lost, once, with its audit row (a system action). False when it was already decided. */
export async function decideChargeback(db: DbOrTx, gatewayDisputeId: string, outcome: 'won' | 'lost'): Promise<boolean> {
  const rows = await db
    .update(chargebacks)
    .set({ status: outcome, updatedAt: new Date() })
    .where(and(eq(chargebacks.gatewayDisputeId, gatewayDisputeId), eq(chargebacks.status, 'open')))
    .returning({ id: chargebacks.id });
  if (rows.length) {
    await writeAudit(db, { actorUserId: null, action: `chargeback.${outcome}`, entityType: 'chargeback', entityId: rows[0]!.id, before: { status: 'open' }, after: { status: outcome } });
  }
  return rows.length > 0;
}
