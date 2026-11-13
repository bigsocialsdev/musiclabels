import { and, desc, eq } from 'drizzle-orm';
import { payoutBatches, payouts } from '@/db/schema';
import { requireOrgMember, type OrgActor } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import { BUCKETS, createSignedDownloadUrl } from '@/lib/platform/storage';

export type SellerPayoutRow = {
  id: string;
  period: string;
  /** `pending`/`processing` while finance prepares and submits it; `failed` carries the royalty into the next run. */
  status: 'pending' | 'processing' | 'paid' | 'failed';
  royaltyBasePaise: number;
  tdsPaise: number;
  sellerGstPaise: number;
  netPaise: number;
  utr: string | null;
  paidAt: Date | null;
  /** True only when the seller can actually download one: the payout is paid and its statement exists. */
  hasStatement: boolean;
};

/** The org's payout lines, newest period first. Bank references and failure details stay with finance. */
export async function listSellerPayouts(db: DbOrTx, actor: OrgActor): Promise<SellerPayoutRow[]> {
  await requireOrgMember(db, actor);
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
    netPaise: p.netPaise,
    utr: p.status === 'paid' ? p.utr : null,
    paidAt: p.paidAt,
    hasStatement: p.status === 'paid' && Boolean(p.statementPdfKey),
  }));
}

/** A short-lived attachment link to the org's own statement for a paid payout; null when it is not theirs or has none yet. */
export async function sellerStatementUrl(db: DbOrTx, actor: OrgActor, payoutId: string): Promise<string | null> {
  await requireOrgMember(db, actor);
  const [row] = await db
    .select({ key: payouts.statementPdfKey, period: payoutBatches.period })
    .from(payouts)
    .innerJoin(payoutBatches, eq(payoutBatches.id, payouts.batchId))
    .where(and(eq(payouts.id, payoutId), eq(payouts.sellerOrgId, actor.orgId), eq(payouts.status, 'paid')));
  if (!row?.key) return null;
  return createSignedDownloadUrl(BUCKETS.pdfs, row.key, 300, `payout-statement-${row.period}.pdf`);
}
