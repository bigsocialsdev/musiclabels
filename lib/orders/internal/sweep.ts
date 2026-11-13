import { and, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { orders } from '@/db/schema';
import { enqueueOpsAlert } from '@/lib/notifications/server';
import { consume } from '@/lib/platform/ratelimit';
import type { PaymentGateway } from '@/lib/payments';
import { listUnprocessedPaymentEvents, recordReconciliationItem } from '@/lib/payments/server';
import type { DbOrTx } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import type { ObjectStore } from '@/lib/platform/storage';
import { fulfilOrder, listPaidOrders } from './fulfil';
import { expireIfUnpaid, listStaleUnpaidOrders, markPaid, processPaymentEvent } from './payment';

export type OrderDeps = { gateway: PaymentGateway; store: ObjectStore };

const HOUR = 1 / 3600;
const DAY = 1 / 86_400;

/** PLAN §10 alerts go to ops at most once per key per window; every failure is still logged. */
async function alertOnce(db: DbOrTx, key: string, perSecond: number, kind: string, title: string, details: Record<string, unknown>) {
  if (await consume(`alert:${key}`, { capacity: 1, refillPerSecond: perSecond }, db)) await enqueueOpsAlert(db, kind, title, details);
}

async function each<T>(db: DbOrTx, ids: string[], what: string, run: (id: string) => Promise<T>): Promise<number> {
  let done = 0;
  for (const id of ids) {
    try {
      await run(id);
      done++;
    } catch (e) {
      log.error(`order sweep: ${what} failed`, { id, error: errorMessage(e) });
      await alertOnce(db, `sweep:${what}`, HOUR, 'handler_failure', `Order sweep: ${what} failed`, { id, error: errorMessage(e).slice(0, 300) });
    }
  }
  return done;
}

/** Orders paid more than 10 minutes ago and still not fulfilled (PLAN §10), one alert per order per day. */
const STUCK_PAID_MINUTES = 10;

/**
 * Backstop for after(): replays unprocessed webhook events, expires (or late-captures) stale unpaid orders,
 * and fulfils every paid order. Each handler claims its row, so this can overlap after() runs. Whatever is
 * still `paid` afterwards is reported to ops.
 */
export async function sweepOrders(db: DbOrTx, deps: OrderDeps) {
  const events = await each(db, await listUnprocessedPaymentEvents(db), 'payment event', (id) => processPaymentEvent(db, id));
  const expired = await each(db, await listStaleUnpaidOrders(db), 'expiry', (id) => expireIfUnpaid(db, id, deps.gateway));
  const fulfilled = await each(db, await listPaidOrders(db), 'fulfil', (id) => fulfilOrder(db, id, deps.store));
  const stuck = await db
    .select({ id: orders.id, lastError: orders.lastError })
    .from(orders)
    .where(and(eq(orders.status, 'paid'), lt(orders.paidAt, sql`now() - make_interval(mins => ${STUCK_PAID_MINUTES})`)));
  for (const o of stuck) {
    await alertOnce(db, `stuck_paid:${o.id}`, DAY, 'stuck_paid', 'Order paid but not fulfilled', { orderId: o.id, lastError: o.lastError });
  }
  return { events, expired, fulfilled, stuckPaid: stuck.length };
}

const IST_OFFSET_MS = 330 * 60_000;

/** The daily cron's window: the previous calendar day in IST. */
export function reconcilePreviousDay(db: DbOrTx, deps: OrderDeps, now: Date = new Date()) {
  const todayIst = Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000) * 86_400_000 - IST_OFFSET_MS;
  return reconcilePayments(db, deps, new Date(todayIst - 86_400_000), new Date(todayIst));
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
  const everCaptured = payments.filter((p) => p.status === 'captured' || p.status === 'refunded');
  let healed = 0;
  for (const p of everCaptured.filter((x) => x.status === 'captured')) {
    const r = await markPaid(db, p, 'reconcile');
    if (r.ok && !r.alreadyPaid) {
      healed++;
      await recordReconciliationItem(db, { kind: 'captured_not_paid', gatewayRef: p.id, orderId: r.orderId, details: { amountPaise: p.amountPaise } });
      await fulfilOrder(db, r.orderId, deps.store).catch((e) => log.error('reconcile fulfil failed', { orderId: r.orderId, error: errorMessage(e) }));
    }
  }
  const capturedIds = new Set(everCaptured.map((p) => p.id));
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
