import { and, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { orders } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { getMembershipRole } from '@/lib/identity/server';
import { enqueueOpsAlert } from '@/lib/notifications/server';
import { HANDLED_EVENT_TYPES, type GatewayPayment, type PaymentGateway } from '@/lib/payments';
import { consume } from '@/lib/platform/ratelimit';
import {
  findRefundByGateway,
  getPaymentEvent,
  markPaymentEventProcessed,
  recordPaymentEvent,
  recordReconciliationItem,
  toGatewayPayment,
  toGatewayRefund,
} from '@/lib/payments/server';
import { applyDisputeEvent } from './chargeback';
import { completeRefund, failRefund } from './refund';
import type { DbOrTx } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import type { OrderStatus } from '../index';
import type { BuyerSession } from './create';
import { applyOrderTransition } from './transition';

export type MarkPaidResult =
  | { ok: true; orderId: string; alreadyPaid: boolean }
  | { ok: false; reason: 'unknown_order' | 'amount_mismatch' | 'duplicate_payment' | 'invalid'; orderId?: string; status?: OrderStatus };

/**
 * The one way an order becomes paid, shared by the webhook, the client callback, the expiry check and
 * reconciliation (CLAUDE.md). Only for a captured payment. The order row is locked, then:
 * same payment again → no-op; a second, different payment → ops alert (refund by hand), not paid twice;
 * amount or currency different from the snapshot → ops alert, order left unpaid; otherwise the
 * compare-and-set to `paid`. The caller kicks fulfilment after commit when `alreadyPaid` is false.
 */
export async function markPaid(db: DbOrTx, payment: GatewayPayment, source: string): Promise<MarkPaidResult> {
  if (payment.status !== 'captured') throw new Error('markPaid needs a captured payment');
  return db.transaction(async (tx) => {
    const [o] = payment.gatewayOrderId ? await tx.select().from(orders).where(eq(orders.gatewayOrderId, payment.gatewayOrderId)).for('update') : [];
    if (!o) {
      await recordReconciliationItem(tx, { kind: 'unknown_payment', gatewayRef: payment.id, details: { gatewayOrderId: payment.gatewayOrderId, amountPaise: payment.amountPaise, source } });
      return { ok: false, reason: 'unknown_order' } as const;
    }
    if (o.gatewayPaymentId === payment.id) return { ok: true, orderId: o.id, alreadyPaid: true } as const;
    if (o.gatewayPaymentId) {
      if (await recordReconciliationItem(tx, { kind: 'duplicate_payment', gatewayRef: payment.id, orderId: o.id, details: { firstPaymentId: o.gatewayPaymentId, amountPaise: payment.amountPaise } })) {
        await enqueueOpsAlert(tx, 'duplicate_payment', 'Second payment captured for one order: refund it', { orderId: o.id, paymentId: payment.id });
      }
      return { ok: false, reason: 'duplicate_payment', orderId: o.id } as const;
    }
    if (payment.amountPaise !== o.totalPaise || payment.currency !== o.currency) {
      if (await recordReconciliationItem(tx, { kind: 'amount_mismatch', gatewayRef: payment.id, orderId: o.id, details: { expected: o.totalPaise, captured: payment.amountPaise, currency: payment.currency } })) {
        await writeAudit(tx, { actorUserId: null, action: 'order.payment_mismatch', entityType: 'order', entityId: o.id, after: { paymentId: payment.id, captured: payment.amountPaise, currency: payment.currency, expected: o.totalPaise } });
        await enqueueOpsAlert(tx, 'amount_mismatch', 'Captured amount does not match the order', { orderId: o.id, paymentId: payment.id });
      }
      return { ok: false, reason: 'amount_mismatch', orderId: o.id } as const;
    }
    // paid_at is when the buyer paid (Razorpay's time), not when we noticed: it starts the term and the royalty hold.
    const r = await applyOrderTransition(tx, o.id, 'capture', { actorUserId: null, reason: source, set: { gatewayPaymentId: payment.id, paidAt: payment.createdAt } });
    if (!r.ok) return { ok: false, reason: 'invalid', orderId: o.id, status: r.status } as const;
    return { ok: true, orderId: o.id, alreadyPaid: false } as const;
  });
}

const entityOf = z.object({ entity: z.unknown() }).optional();
const webhookSchema = z.object({
  event: z.string(),
  payload: z.object({ payment: entityOf, refund: entityOf, dispute: entityOf }).passthrough(),
});

/**
 * Applies one stored webhook event, marking it processed in the same transaction as its effect.
 * Returns the order to fulfil, if this event made it paid.
 */
export async function processPaymentEvent(db: DbOrTx, eventId: string): Promise<{ fulfilOrderId?: string }> {
  const ev = await getPaymentEvent(db, eventId);
  if (!ev || ev.processedAt) return {};
  // Unhandled types stay stored and unprocessed, so a later handler can still pick them up.
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(ev.eventType)) return {};
  const body = webhookSchema.parse(ev.payload);
  const entity = body.payload.payment?.entity;

  if ((ev.eventType === 'refund.processed' || ev.eventType === 'refund.failed') && body.payload.refund?.entity) {
    const r = toGatewayRefund(body.payload.refund.entity);
    await db.transaction(async (tx) => {
      const row = await findRefundByGateway(tx, r.id, r.receipt);
      if (!row) await enqueueOpsAlert(tx, 'refund_unknown', 'Razorpay refund with no refund row (made outside the platform?)', { gatewayRefundId: r.id, paymentId: r.paymentId });
      else if (ev.eventType === 'refund.processed') await completeRefund(tx, row.id); // credit-note PDF is rendered by the sweep
      else await failRefund(tx, row.id, 'refund.failed webhook');
      await markPaymentEventProcessed(tx, ev.id);
    });
    return {};
  }
  if (ev.eventType.startsWith('payment.dispute.') && body.payload.dispute?.entity) {
    const outcome = ev.eventType.slice('payment.dispute.'.length) as 'created' | 'won' | 'lost';
    await db.transaction(async (tx) => {
      await applyDisputeEvent(tx, outcome, body.payload.dispute!.entity);
      await markPaymentEventProcessed(tx, ev.id);
    });
    return {};
  }

  if ((ev.eventType === 'payment.captured' || ev.eventType === 'order.paid') && entity) {
    const payment = toGatewayPayment(entity);
    return db.transaction(async (tx) => {
      const r = payment.status === 'captured' ? await markPaid(tx, payment, `webhook:${ev.eventType}`) : null;
      await markPaymentEventProcessed(tx, ev.id);
      return r?.ok && !r.alreadyPaid ? { fulfilOrderId: r.orderId } : {};
    });
  }
  if (ev.eventType === 'payment.failed' && entity) {
    const payment = toGatewayPayment(entity);
    await db.transaction(async (tx) => {
      const [o] = payment.gatewayOrderId ? await tx.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.gatewayOrderId, payment.gatewayOrderId)) : [];
      if (o?.status === 'awaiting_payment') await applyOrderTransition(tx, o.id, 'fail', { actorUserId: null, reason: `payment ${payment.id} failed` });
      await markPaymentEventProcessed(tx, ev.id);
    });
    return {};
  }
  await markPaymentEventProcessed(db, ev.id); // a handled type carrying no payment entity: nothing to apply
  return {};
}

export type WebhookOutcome = { status: 200 | 400 | 401; fulfilOrderId?: string };

/**
 * Razorpay webhook (PLAN §8.1): HMAC over the raw body (constant-time) first, then a dedupe insert on
 * x-razorpay-event-id. 2xx after a successful insert even if processing fails: the event keeps
 * processed_at null and the sweep retries it, not Razorpay.
 */
export async function handleRazorpayWebhook(
  db: DbOrTx,
  req: { rawBody: string; signature: string | null; eventId: string | null },
  gateway: PaymentGateway,
): Promise<WebhookOutcome> {
  if (!req.signature || !gateway.verifyWebhook(req.rawBody, req.signature)) {
    log.error('razorpay webhook signature rejected', { eventId: req.eventId });
    // Anyone can post here, so the ops email is capped at one an hour; every rejection is still logged.
    if (await consume('alert:webhook_signature', { capacity: 1, refillPerSecond: 1 / 3600 }, db)) {
      await enqueueOpsAlert(db, 'webhook_signature', 'Razorpay webhook signature rejected', { eventId: req.eventId });
    }
    return { status: 401 };
  }
  if (!req.eventId) return { status: 400 };
  let body: z.infer<typeof webhookSchema>;
  try {
    body = webhookSchema.parse(JSON.parse(req.rawBody));
  } catch {
    return { status: 400 };
  }
  const recorded = await recordPaymentEvent(db, { gatewayEventId: req.eventId, eventType: body.event, payload: body });
  if (!recorded.inserted) return { status: 200 };
  try {
    return { status: 200, ...(await processPaymentEvent(db, recorded.id)) };
  } catch (e) {
    log.error('razorpay webhook processing failed; sweep will retry', { eventId: req.eventId, error: errorMessage(e) });
    return { status: 200 };
  }
}

export type CallbackResult =
  | { ok: true; status: 'paid' | 'pending'; orderId: string; fulfil: boolean }
  | { ok: false; reason: 'not_found' | 'invalid_signature' | 'payment_failed' | 'amount_mismatch' | 'duplicate_payment' | 'invalid' };

/**
 * Client callback after Razorpay Checkout: verify the signature, then fetch the payment from Razorpay
 * (the browser's word is never enough) and call the same markPaid as the webhook. An authorized-but-not-yet
 * captured payment is left for the webhook.
 */
export async function verifyCheckoutCallback(
  db: DbOrTx,
  buyer: BuyerSession,
  input: { orderId: string; paymentId: string; gatewayOrderId: string; signature: string },
  gateway: PaymentGateway,
): Promise<CallbackResult> {
  if (!(await getMembershipRole(db, buyer.userId, buyer.orgId))) return { ok: false, reason: 'not_found' };
  const [o] = await db
    .select({ id: orders.id, gatewayOrderId: orders.gatewayOrderId })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.buyerOrgId, buyer.orgId)));
  if (!o || o.gatewayOrderId !== input.gatewayOrderId) return { ok: false, reason: 'not_found' };
  if (!gateway.verifyCallbackSignature({ gatewayOrderId: input.gatewayOrderId, paymentId: input.paymentId, signature: input.signature })) {
    return { ok: false, reason: 'invalid_signature' };
  }
  const payment = await gateway.fetchPayment(input.paymentId);
  if (payment.gatewayOrderId !== o.gatewayOrderId) return { ok: false, reason: 'invalid_signature' };
  if (payment.status === 'failed') return { ok: false, reason: 'payment_failed' };
  if (payment.status !== 'captured') return { ok: true, status: 'pending', orderId: o.id, fulfil: false };
  const r = await markPaid(db, payment, 'callback');
  if (!r.ok) return { ok: false, reason: r.reason === 'unknown_order' ? 'not_found' : r.reason };
  return { ok: true, status: 'paid', orderId: o.id, fulfil: !r.alreadyPaid };
}

/**
 * Lazy expiry (PLAN §5.7): an awaiting_payment order past expires_at is checked against Razorpay first;
 * a captured payment makes it paid instead. Returns the order to fulfil when that happens.
 */
export async function expireIfUnpaid(
  db: DbOrTx,
  orderId: string,
  gateway: PaymentGateway,
  now: Date = new Date(),
): Promise<{ status: OrderStatus | null; fulfilOrderId?: string }> {
  const [o] = await db.select({ status: orders.status, gatewayOrderId: orders.gatewayOrderId, expiresAt: orders.expiresAt }).from(orders).where(eq(orders.id, orderId));
  if (!o) return { status: null };
  if (o.status !== 'awaiting_payment' || o.expiresAt > now || !o.gatewayOrderId) return { status: o.status as OrderStatus };
  const captured = (await gateway.fetchOrderPayments(o.gatewayOrderId)).find((p) => p.status === 'captured');
  if (captured) {
    const r = await markPaid(db, captured, 'expiry_check');
    return { status: r.ok ? 'paid' : (o.status as OrderStatus), fulfilOrderId: r.ok && !r.alreadyPaid ? r.orderId : undefined };
  }
  const t = await applyOrderTransition(db, orderId, 'expire', { actorUserId: null, reason: 'payment window elapsed' });
  return { status: t.ok ? t.to : (t.status ?? null) };
}

/** Sweep input: awaiting_payment orders past expiry. */
export async function listStaleUnpaidOrders(db: DbOrTx, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'awaiting_payment'), lt(orders.expiresAt, new Date())))
    .limit(limit);
  return rows.map((r) => r.id);
}
