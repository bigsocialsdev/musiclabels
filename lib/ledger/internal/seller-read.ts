import { eq, sql } from 'drizzle-orm';
import { ledgerEntries } from '@/db/schema';
import { getMembershipRole } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';

/** The caller as established by the action: a signed-in user acting for one of their organisations. */
export type LedgerActor = { userId: string; orgId: string };

export class LedgerReadError extends Error {}

async function requireMember(db: DbOrTx, actor: LedgerActor) {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) throw new LedgerReadError('forbidden');
}

export type LedgerKind = 'sale_royalty' | 'refund_reversal' | 'chargeback_reversal' | 'clawback' | 'payout' | 'adjustment';

export type SellerLedgerRow = {
  id: string;
  kind: LedgerKind;
  amountPaise: number;
  at: Date;
  availableAt: Date;
  /** For entries tied to an order: what was sold. The buyer is not shown. */
  trackTitle: string | null;
  tier: string | null;
  taxablePaise: number | null;
};

/**
 * The org's ledger, newest first, for its own members. The sale details come from the order and its license; the
 * buyer's identity is deliberately not part of what a seller sees.
 */
export async function listSellerLedger(db: DbOrTx, actor: LedgerActor, opts: { limit?: number } = {}): Promise<SellerLedgerRow[]> {
  await requireMember(db, actor);
  const rows = await db.execute<{ id: string; kind: LedgerKind; amount_paise: string; created_at: Date; available_at: Date; track_title: string | null; tier: string | null; taxable_paise: string | null }>(sql`
    SELECT e.id, e.kind, e.amount_paise, e.created_at, e.available_at, l.track_title, o.tier, o.taxable_paise
    FROM ledger_entries e
    LEFT JOIN orders o ON o.id = e.order_id
    LEFT JOIN licenses l ON l.order_id = e.order_id
    WHERE e.seller_org_id = ${actor.orgId}
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT ${Math.min(opts.limit ?? 200, 5000)}`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    amountPaise: Number(r.amount_paise),
    at: new Date(r.created_at),
    availableAt: new Date(r.available_at),
    trackTitle: r.track_title,
    tier: r.tier,
    taxablePaise: r.taxable_paise === null ? null : Number(r.taxable_paise),
  }));
}

/** What the seller is owed: matured (available for the next payout run) and still inside the hold. Payouts already debit the matured part. */
export async function getSellerBalances(db: DbOrTx, actor: LedgerActor, at: Date = new Date()): Promise<{ availablePaise: number; heldPaise: number }> {
  await requireMember(db, actor);
  const [row] = await db
    .select({
      available: sql<string>`coalesce(sum(${ledgerEntries.amountPaise}) filter (where ${ledgerEntries.availableAt} <= ${at.toISOString()}::timestamptz), 0)`,
      held: sql<string>`coalesce(sum(${ledgerEntries.amountPaise}) filter (where ${ledgerEntries.availableAt} > ${at.toISOString()}::timestamptz), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.sellerOrgId, actor.orgId));
  return { availablePaise: Number(row!.available), heldPaise: Number(row!.held) };
}
