import { and, eq } from 'drizzle-orm';
import { chargebacks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';

/** Idempotent on Razorpay's dispute id. Returns whether this call created the row. */
export async function recordChargeback(db: DbOrTx, input: { orderId: string; gatewayDisputeId: string; amountPaise: number }): Promise<boolean> {
  const rows = await db.insert(chargebacks).values(input).onConflictDoNothing({ target: chargebacks.gatewayDisputeId }).returning({ id: chargebacks.id });
  return rows.length > 0;
}

/** open → won | lost, once. False when it was already decided. */
export async function decideChargeback(db: DbOrTx, gatewayDisputeId: string, outcome: 'won' | 'lost'): Promise<boolean> {
  const rows = await db
    .update(chargebacks)
    .set({ status: outcome, updatedAt: new Date() })
    .where(and(eq(chargebacks.gatewayDisputeId, gatewayDisputeId), eq(chargebacks.status, 'open')))
    .returning({ id: chargebacks.id });
  return rows.length > 0;
}
