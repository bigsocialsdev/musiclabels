import { and, gte, isNotNull, lt } from 'drizzle-orm';
import { orders } from '@/db/schema';
import type { PaymentGateway } from '@/lib/payments';
import { listUnprocessedPaymentEvents, recordReconciliationItem } from '@/lib/payments/server';
import type { DbOrTx } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import type { ObjectStore } from '@/lib/platform/storage';
import { fulfilOrder, listPaidOrders } from './fulfil';
import { expireIfUnpaid, listStaleUnpaidOrders, markPaid, processPaymentEvent } from './payment';

export type OrderDeps = { gateway: PaymentGateway; store: ObjectStore };

async function each<T>(ids: string[], what: string, run: (id: string) => Promise<T>): Promise<number> {
  let done = 0;
  for (const id of ids) {
    try {
      await run(id);
      done++;
    } catch (e) {
      log.error(`order sweep: ${what} failed`, { id, error: errorMessage(e) });
    }
  }
  return done;
}

/**
 * Backstop for after(): replays unprocessed webhook events, expires (or late-captures) stale unpaid orders,
 * and fulfils every paid order. Each handler claims its row, so this can overlap after() runs.
 */
export async function sweepOrders(db: DbOrTx, deps: OrderDeps) {
  const events = await each(await listUnprocessedPaymentEvents(db), 'payment event', (id) => processPaymentEvent(db, id));
  const expired = await each(await listStaleUnpaidOrders(db), 'expiry', (id) => expireIfUnpaid(db, id, deps.gateway));
  const fulfilled = await each(await listPaidOrders(db), 'fulfil', (id) => fulfilOrder(db, id, deps.store));
  return { events, expired, fulfilled };
}

/**
 * Daily reconciliation (PLAN §5.7) for payments created in [from, to): every captured payment goes through
 * markPaid, which pays a captured-but-unpaid order (recorded as `captured_not_paid`) and records unknown,
 * duplicate and mismatched payments; orders paid in the window with no captured payment are recorded as
 * `paid_without_capture`. Settlements and refund/credit-note checks arrive with S3-M5.
 */
export async function reconcilePayments(db: DbOrTx, deps: OrderDeps, from: Date, to: Date) {
  // An hour either side, so a payment created just before `from` but captured inside the window still matches.
  const payments = await deps.gateway.listPayments(new Date(from.getTime() - 3_600_000), new Date(to.getTime() + 3_600_000));
  const captured = payments.filter((p) => p.status === 'captured' || p.status === 'refunded');
  let healed = 0;
  for (const p of captured.filter((x) => x.status === 'captured')) {
    const r = await markPaid(db, p, 'reconcile');
    if (r.ok && !r.alreadyPaid) {
      healed++;
      await recordReconciliationItem(db, { kind: 'captured_not_paid', gatewayRef: p.id, orderId: r.orderId, details: { amountPaise: p.amountPaise } });
      await fulfilOrder(db, r.orderId, deps.store).catch((e) => log.error('reconcile fulfil failed', { orderId: r.orderId, error: errorMessage(e) }));
    }
  }
  const capturedIds = new Set(captured.map((p) => p.id));
  const paidInWindow = await db
    .select({ id: orders.id, paymentId: orders.gatewayPaymentId })
    .from(orders)
    .where(and(isNotNull(orders.gatewayPaymentId), gte(orders.paidAt, from), lt(orders.paidAt, to)));
  let missing = 0;
  for (const o of paidInWindow) {
    if (!capturedIds.has(o.paymentId!)) {
      missing++;
      await recordReconciliationItem(db, { kind: 'paid_without_capture', gatewayRef: o.paymentId!, orderId: o.id });
    }
  }
  return { payments: payments.length, healed, paidWithoutCapture: missing };
}
