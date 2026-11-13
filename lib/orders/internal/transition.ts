import { and, eq } from 'drizzle-orm';
import { orderEvents, orders } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import type { DbOrTx } from '@/lib/platform/db';
import { nextOrderStatus, type OrderEvent, type OrderStatus } from '../index';

export type OrderTransitionResult =
  | { ok: true; from: OrderStatus; to: OrderStatus }
  | { ok: false; reason: 'not_found' | 'invalid' | 'conflict'; status?: OrderStatus };

type Patch = Partial<Pick<typeof orders.$inferInsert, 'gatewayOrderId' | 'gatewayPaymentId' | 'paidAt' | 'fulfilledAt' | 'fulfilClaimedAt' | 'lastError'>>;

/**
 * Compare-and-set `UPDATE orders … WHERE id = $1 AND status = $from` with its order_events row, and an
 * audit_log row for system (actorUserId null) and admin (`adminAction`) moves, all in one transaction. Zero rows updated
 * means another actor moved the order first: return its current status, do nothing.
 */
export async function applyOrderTransition(
  db: DbOrTx,
  orderId: string,
  event: OrderEvent,
  opts: { actorUserId: string | null; reason?: string | null; set?: Patch; adminAction?: boolean },
): Promise<OrderTransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    if (!current) return { ok: false, reason: 'not_found' } as const;
    const from = current.status as OrderStatus;
    const to = nextOrderStatus(from, event);
    if (!to) return { ok: false, reason: 'invalid', status: from } as const;

    const updated = await tx
      .update(orders)
      .set({ ...opts.set, status: to, updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, from)))
      .returning({ id: orders.id });
    if (updated.length === 0) {
      const [now] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
      return { ok: false, reason: 'conflict', status: now?.status as OrderStatus | undefined } as const;
    }
    await tx.insert(orderEvents).values({ orderId, fromStatus: from, toStatus: to, event, actorUserId: opts.actorUserId, reason: opts.reason ?? null });
    if (opts.actorUserId === null || opts.adminAction) {
      await writeAudit(tx, { actorUserId: opts.actorUserId, action: `order.${event}`, entityType: 'order', entityId: orderId, before: { status: from }, after: { status: to, reason: opts.reason ?? null } });
    }
    return { ok: true, from, to } as const;
  });
}
