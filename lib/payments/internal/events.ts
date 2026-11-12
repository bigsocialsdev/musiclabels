import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { paymentEvents, reconciliationItems } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { HANDLED_EVENT_TYPES } from '../index';

export type PaymentEvent = typeof paymentEvents.$inferSelect;

/**
 * Dedupe insert keyed by Razorpay's x-razorpay-event-id. A duplicate delivery is a successful no-op:
 * `inserted: false` and nothing else happens.
 */
export async function recordPaymentEvent(
  db: DbOrTx,
  e: { gatewayEventId: string; eventType: string; payload: unknown },
): Promise<{ id: string; inserted: boolean }> {
  const [row] = await db
    .insert(paymentEvents)
    .values({ gatewayEventId: e.gatewayEventId, eventType: e.eventType, payload: e.payload })
    .onConflictDoNothing({ target: paymentEvents.gatewayEventId })
    .returning({ id: paymentEvents.id });
  if (row) return { id: row.id, inserted: true };
  const [existing] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(eq(paymentEvents.gatewayEventId, e.gatewayEventId));
  return { id: existing!.id, inserted: false };
}

export async function getPaymentEvent(db: DbOrTx, id: string): Promise<PaymentEvent | null> {
  const [row] = await db.select().from(paymentEvents).where(eq(paymentEvents.id, id));
  return row ?? null;
}

/** Sets processed_at once; call in the same transaction as the effect it records. False if already processed. */
export async function markPaymentEventProcessed(db: DbOrTx, id: string): Promise<boolean> {
  const rows = await db
    .update(paymentEvents)
    .set({ processedAt: new Date() })
    .where(and(eq(paymentEvents.id, id), isNull(paymentEvents.processedAt)))
    .returning({ id: paymentEvents.id });
  return rows.length > 0;
}

/** Handled events still waiting (processing failed or the process died), oldest first. */
export async function listUnprocessedPaymentEvents(db: DbOrTx, limit = 100): Promise<string[]> {
  const rows = await db
    .select({ id: paymentEvents.id })
    .from(paymentEvents)
    .where(and(isNull(paymentEvents.processedAt), inArray(paymentEvents.eventType, [...HANDLED_EVENT_TYPES])))
    .orderBy(asc(paymentEvents.receivedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

export type ReconciliationKind = 'unknown_payment' | 'captured_not_paid' | 'amount_mismatch' | 'paid_without_capture' | 'duplicate_payment';

/** One open item per (kind, gateway reference); re-running reconciliation adds nothing new. */
export async function recordReconciliationItem(
  db: DbOrTx,
  item: { kind: ReconciliationKind; gatewayRef: string; orderId?: string | null; details?: Record<string, unknown> },
): Promise<boolean> {
  const rows = await db
    .insert(reconciliationItems)
    .values({ kind: item.kind, gatewayRef: item.gatewayRef, orderId: item.orderId ?? null, details: item.details ?? {} })
    .onConflictDoNothing()
    .returning({ id: reconciliationItems.id });
  return rows.length > 0;
}
