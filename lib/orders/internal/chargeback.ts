import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '@/db/schema';
import { reverseSaleRoyalty } from '@/lib/ledger/server';
import { getLicenseByOrder, revokeLicense } from '@/lib/licensing/server';
import { enqueueOpsAlert } from '@/lib/notifications/server';
import { decideChargeback, recordChargeback } from '@/lib/payments/server';
import type { DbOrTx } from '@/lib/platform/db';
import { applyOrderTransition } from './transition';

export const disputeEntitySchema = z.object({ id: z.string(), payment_id: z.string(), amount: z.number().int() });

/**
 * Razorpay dispute events (PLAN §4.3): created → charged_back_pending; won → back to fulfilled; lost →
 * charged_back with the license revoked and the royalty reversed, in one transaction. A decision that arrives
 * without its `created` event records the chargeback first. Orders not in the expected state are recorded and
 * flagged to ops rather than forced.
 */
export async function applyDisputeEvent(db: DbOrTx, event: 'created' | 'won' | 'lost', raw: unknown): Promise<void> {
  const d = disputeEntitySchema.parse(raw);
  await db.transaction(async (tx) => {
    const [o] = await tx.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.gatewayPaymentId, d.payment_id)).for('update');
    if (!o) {
      await enqueueOpsAlert(tx, 'chargeback_unknown_payment', 'Dispute for a payment with no order', { disputeId: d.id, paymentId: d.payment_id });
      return;
    }
    const created = await recordChargeback(tx, { orderId: o.id, gatewayDisputeId: d.id, amountPaise: d.amount });
    let status = o.status;
    if (status === 'fulfilled') {
      await applyOrderTransition(tx, o.id, 'chargeback', { actorUserId: null, reason: `dispute ${d.id}` });
      status = 'charged_back_pending';
    }
    if (created) await enqueueOpsAlert(tx, 'chargeback_opened', 'Chargeback opened: submit evidence in Razorpay', { orderId: o.id, disputeId: d.id });
    if (event === 'created') return;

    if (!(await decideChargeback(tx, d.id, event))) return; // already decided
    if (status !== 'charged_back_pending') {
      await enqueueOpsAlert(tx, 'chargeback_state', `Chargeback ${event} on an order in ${status}`, { orderId: o.id, disputeId: d.id });
      return;
    }
    if (event === 'won') {
      await applyOrderTransition(tx, o.id, 'chargeback_won', { actorUserId: null, reason: `dispute ${d.id}` });
      return;
    }
    await applyOrderTransition(tx, o.id, 'chargeback_lost', { actorUserId: null, reason: `dispute ${d.id}` });
    const license = await getLicenseByOrder(tx, o.id);
    if (license) await revokeLicense(tx, license.id, { reason: 'chargeback_lost', note: `dispute ${d.id}` });
    await reverseSaleRoyalty(tx, { orderId: o.id, kind: 'chargeback_reversal' });
  });
}
