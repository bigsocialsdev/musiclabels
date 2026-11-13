import { and, eq, lte, sql } from 'drizzle-orm';
import { ledgerEntries } from '@/db/schema';
import type { DbOrTx, Tx } from '@/lib/platform/db';
import { ROYALTY_HOLD_DAYS, royaltyPaise } from '../index';

/**
 * Credits the seller's royalty for a paid order, available after the hold. Runs inside fulfilment's
 * legal-facts transaction; unique (order_id, kind) makes a re-run a no-op.
 */
export async function creditSaleRoyalty(
  tx: Tx,
  input: { orderId: string; sellerOrgId: string; taxablePaise: number; royaltyRateBps: number; paidAt: Date },
): Promise<void> {
  await tx
    .insert(ledgerEntries)
    .values({
      sellerOrgId: input.sellerOrgId,
      kind: 'sale_royalty',
      amountPaise: royaltyPaise(input.taxablePaise, input.royaltyRateBps),
      orderId: input.orderId,
      availableAt: new Date(input.paidAt.getTime() + ROYALTY_HOLD_DAYS * 86_400_000),
    })
    .onConflictDoNothing();
}

/**
 * Reverses an order's full royalty (PLAN §8.3). It becomes available when the original credit does, or now if
 * that has passed: a royalty still on hold simply nets to zero at maturity, and one already paid out leaves a
 * negative balance the next payout run nets against (clawback, F2). No royalty for the order (it was never
 * fulfilled) means nothing to reverse. Idempotent per (order, kind).
 */
export async function reverseSaleRoyalty(tx: Tx, input: { orderId: string; kind: 'refund_reversal' | 'chargeback_reversal'; createdBy?: string | null }): Promise<boolean> {
  const [credit] = await tx
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.orderId, input.orderId), eq(ledgerEntries.kind, 'sale_royalty')));
  if (!credit) return false;
  const rows = await tx
    .insert(ledgerEntries)
    .values({
      sellerOrgId: credit.sellerOrgId,
      kind: input.kind,
      amountPaise: -credit.amountPaise,
      orderId: input.orderId,
      availableAt: sql`greatest(now(), ${credit.availableAt.toISOString()}::timestamptz)`,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: ledgerEntries.id });
  return rows.length > 0;
}

/** Each seller's available balance at the cutoff: every entry available by then, payout debits included. */
export async function availableBalances(db: DbOrTx, cutoff: Date): Promise<Map<string, number>> {
  const rows = await db
    .select({ sellerOrgId: ledgerEntries.sellerOrgId, balance: sql<string>`sum(${ledgerEntries.amountPaise})` })
    .from(ledgerEntries)
    .where(lte(ledgerEntries.availableAt, cutoff))
    .groupBy(ledgerEntries.sellerOrgId);
  return new Map(rows.map((r) => [r.sellerOrgId, Number(r.balance)]));
}

export async function sellerBalance(db: DbOrTx, sellerOrgId: string, at: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${ledgerEntries.amountPaise}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.sellerOrgId, sellerOrgId), lte(ledgerEntries.availableAt, at)));
  return Number(row!.balance);
}

/** A paid payout discharges its royalty base. One debit per payout (unique index); dated at the batch cutoff. */
export async function debitPayout(tx: Tx, input: { payoutId: string; sellerOrgId: string; amountPaise: number; cutoffAt: Date; createdBy: string | null }): Promise<void> {
  await tx
    .insert(ledgerEntries)
    .values({ sellerOrgId: input.sellerOrgId, kind: 'payout', amountPaise: -input.amountPaise, payoutId: input.payoutId, availableAt: input.cutoffAt, createdBy: input.createdBy })
    .onConflictDoNothing();
}
