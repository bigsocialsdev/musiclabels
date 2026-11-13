import { and, desc, eq } from 'drizzle-orm';
import { payoutBatches, payouts } from '@/db/schema';
import { getMembershipRole } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import { BUCKETS, createSignedDownloadUrl } from '@/lib/platform/storage';

export type PayoutActor = { userId: string; orgId: string };

export class PayoutReadError extends Error {}

async function requireMember(db: DbOrTx, actor: PayoutActor) {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) throw new PayoutReadError('forbidden');
}

export type SellerPayoutRow = {
  id: string;
  period: string;
  /** `pending`/`processing` while finance prepares and submits it; `failed` carries the royalty into the next run. */
  status: 'pending' | 'processing' | 'paid' | 'failed';
  royaltyBasePaise: number;
  tdsPaise: number;
  sellerGstPaise: number;
  rcmGstPaise: number;
  netPaise: number;
  utr: string | null;
  paidAt: Date | null;
  hasStatement: boolean;
};

/** The org's payout lines, newest period first. Bank references and failure details stay with finance. */
export async function listSellerPayouts(db: DbOrTx, actor: PayoutActor): Promise<SellerPayoutRow[]> {
  await requireMember(db, actor);
  const rows = await db
    .select({ p: payouts, period: payoutBatches.period })
    .from(payouts)
    .innerJoin(payoutBatches, eq(payoutBatches.id, payouts.batchId))
    .where(eq(payouts.sellerOrgId, actor.orgId))
    .orderBy(desc(payoutBatches.period));
  return rows.map(({ p, period }) => ({
    id: p.id,
    period,
    status: p.status as SellerPayoutRow['status'],
    royaltyBasePaise: p.royaltyBasePaise,
    tdsPaise: p.tdsPaise,
    sellerGstPaise: p.sellerGstPaise,
    rcmGstPaise: p.rcmGstPaise,
    netPaise: p.netPaise,
    utr: p.status === 'paid' ? p.utr : null,
    paidAt: p.paidAt,
    hasStatement: Boolean(p.statementPdfKey),
  }));
}

/** A short-lived attachment link to the org's own statement for a paid payout; null when it is not theirs or has none yet. */
export async function sellerStatementUrl(db: DbOrTx, actor: PayoutActor, payoutId: string): Promise<string | null> {
  await requireMember(db, actor);
  const [row] = await db
    .select({ key: payouts.statementPdfKey, period: payoutBatches.period })
    .from(payouts)
    .innerJoin(payoutBatches, eq(payoutBatches.id, payouts.batchId))
    .where(and(eq(payouts.id, payoutId), eq(payouts.sellerOrgId, actor.orgId), eq(payouts.status, 'paid')));
  if (!row?.key) return null;
  return createSignedDownloadUrl(BUCKETS.pdfs, row.key, 300, `payout-statement-${row.period}.pdf`);
}
