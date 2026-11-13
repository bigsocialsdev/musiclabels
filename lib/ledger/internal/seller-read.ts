import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { ledgerEntries, licenses, orders, payouts } from '@/db/schema';
import { requireOrgMember, type OrgActor } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import type { LedgerKind } from '../index';
import { sellerBalance } from './entries';

export type SellerLedgerRow = {
  id: string;
  kind: LedgerKind;
  amountPaise: number;
  at: Date;
  availableAt: Date;
  /** `paid_out` for payout debits, `on_hold` inside the 30-day hold, otherwise `matured`. */
  status: 'paid_out' | 'on_hold' | 'matured';
  /** For entries tied to an order: what was sold. The buyer is not shown. */
  trackTitle: string | null;
  tier: string | null;
  taxablePaise: number | null;
};

/**
 * The org's ledger, newest first, for its own members. The sale details come from the order and its license; the
 * buyer's identity is deliberately not part of what a seller sees.
 */
export async function listSellerLedger(db: DbOrTx, actor: OrgActor, opts: { limit?: number; at?: Date } = {}): Promise<SellerLedgerRow[]> {
  await requireOrgMember(db, actor);
  const at = opts.at ?? new Date();
  const rows = await db
    .select({ e: ledgerEntries, trackTitle: licenses.trackTitle, tier: orders.tier, taxablePaise: orders.taxablePaise })
    .from(ledgerEntries)
    .leftJoin(orders, eq(orders.id, ledgerEntries.orderId))
    .leftJoin(licenses, eq(licenses.orderId, ledgerEntries.orderId))
    .where(eq(ledgerEntries.sellerOrgId, actor.orgId))
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(Math.min(opts.limit ?? 200, 5000));
  return rows.map(({ e, trackTitle, tier, taxablePaise }) => ({
    id: e.id,
    kind: e.kind as LedgerKind,
    amountPaise: e.amountPaise,
    at: e.createdAt,
    availableAt: e.availableAt,
    status: e.kind === 'payout' ? 'paid_out' : e.availableAt > at ? 'on_hold' : 'matured',
    trackTitle,
    tier,
    taxablePaise,
  }));
}

/**
 * What the seller is owed, in three parts: still inside the hold; matured and not yet in a payout run; and already
 * in a run that finance is preparing or has sent to the bank (the ledger debit is written only when it is paid).
 * Whether a run actually picks up the free part also depends on KYC, a verified bank account and the minimum.
 */
export async function getSellerBalances(db: DbOrTx, actor: OrgActor, at: Date = new Date()): Promise<{ availablePaise: number; inPayoutPaise: number; heldPaise: number }> {
  await requireOrgMember(db, actor);
  const matured = await sellerBalance(db, actor.orgId, at);
  const [held] = await db
    .select({ n: sql<string>`coalesce(sum(${ledgerEntries.amountPaise}), 0)` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.sellerOrgId, actor.orgId), gt(ledgerEntries.availableAt, at)));
  const [inRun] = await db
    .select({ n: sql<string>`coalesce(sum(${payouts.royaltyBasePaise}), 0)` })
    .from(payouts)
    .where(and(eq(payouts.sellerOrgId, actor.orgId), inArray(payouts.status, ['pending', 'processing'])));
  const inPayoutPaise = Number(inRun!.n);
  return { availablePaise: matured - inPayoutPaise, inPayoutPaise, heldPaise: Number(held!.n) };
}
