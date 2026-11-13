import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { organizations, payoutBatches, payouts } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import { financialYear, getBillingConfig } from '@/lib/invoicing/server';
import { availableBalances, debitPayout } from '@/lib/ledger/server';
import { enqueueEmail } from '@/lib/notifications/server';
import type { DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { BUCKETS, type ObjectStore } from '@/lib/platform/storage';
import { getSellerStanding, getVerifiedBankDetails } from '@/lib/sellers/server';
import { computePayoutLine, istDayOfMonth, periodCutoff, previousPeriod, type PayoutRail, type PayoutTaxConfig, type RailLine } from '../index';
import { renderPayoutStatement } from './statement-pdf';

export type PayoutBatch = typeof payoutBatches.$inferSelect;
export type Payout = typeof payouts.$inferSelect;

/** [CA] values from env, checked at use. */
export function getPayoutConfig(): PayoutTaxConfig {
  const e = getEnv();
  const need = { TDS_RATE_BPS: e.TDS_RATE_BPS, TDS_RATE_NO_PAN_BPS: e.TDS_RATE_NO_PAN_BPS, TDS_FY_THRESHOLD_PAISE: e.TDS_FY_THRESHOLD_PAISE, RCM_ON_UNREGISTERED_SELLERS: e.RCM_ON_UNREGISTERED_SELLERS, PAYOUT_MIN_PAISE: e.PAYOUT_MIN_PAISE };
  const missing = Object.entries(need).filter(([, v]) => v === undefined).map(([k]) => k);
  if (missing.length) throw new Error(`payout config missing: ${missing.join(', ')}`);
  return {
    tdsRateBps: e.TDS_RATE_BPS!,
    tdsRateNoPanBps: e.TDS_RATE_NO_PAN_BPS!,
    tdsFyThresholdPaise: e.TDS_FY_THRESHOLD_PAISE!,
    rcmOnUnregistered: e.RCM_ON_UNREGISTERED_SELLERS === 'true',
    gstRateBps: getBillingConfig().gstRateBps,
    minPayoutPaise: e.PAYOUT_MIN_PAISE!,
  };
}

const audit = (tx: DbOrTx, actor: string | null, action: string, entityId: string, after: unknown) =>
  writeAudit(tx, { actorUserId: actor, action, entityType: 'payout_batch', entityId, after });

export type ComputeResult = { batch: PayoutBatch; created: boolean; lines: number; skipped: { sellerOrgId: string; reason: string }[] };

/**
 * Monthly run (PLAN §5.6): one batch per period. Each seller's available balance at the cutoff (all entries
 * available by then, earlier payout debits included) is paid when it is at least the minimum, the seller's KYC
 * and bank account are verified, and no earlier payout of theirs is still unsettled; otherwise it carries
 * forward, including negative balances from clawbacks (F2). Re-running for the same period returns the batch.
 * `admin` null = the payouts cron.
 */
export async function computePayoutBatch(db: DbOrTx, admin: AdminContext | null, period: string): Promise<ComputeResult> {
  if (admin) requirePermission(admin, 'finance');
  const cutoffAt = periodCutoff(period);
  const cfg = getPayoutConfig();
  return db.transaction(async (tx) => {
    // One lock for all periods: the ordering check below must not race another period's compute.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payout_batch'))`);
    const [existing] = await tx.select().from(payoutBatches).where(eq(payoutBatches.period, period));
    if (existing) return { batch: existing, created: false, lines: 0, skipped: [] };
    if (cutoffAt > new Date()) throw new Error(`period ${period} has not ended`);
    // Periods run in order. A balance is "everything available by the cutoff", and a payout's debit is dated at its
    // batch's cutoff, so an earlier period computed after a later one would not see that debit and pay twice.
    const [latest] = await tx.select({ cutoffAt: payoutBatches.cutoffAt, period: payoutBatches.period }).from(payoutBatches).orderBy(desc(payoutBatches.cutoffAt)).limit(1);
    if (latest && cutoffAt <= latest.cutoffAt) throw new Error(`period ${period} is not after the latest batch (${latest.period}); payout periods run in order`);

    const [batch] = await tx.insert(payoutBatches).values({ period, cutoffAt }).returning();
    const unsettled = new Set(
      (await tx.select({ s: payouts.sellerOrgId }).from(payouts).where(inArray(payouts.status, ['pending', 'processing']))).map((r) => r.s),
    );
    // A period's FY is that of its month: the cutoff itself is the next month's first instant (March → 1 April).
    const fy = financialYear(new Date(cutoffAt.getTime() - 1));
    const fyFrom = fyStart(fy);
    const fyTo = fyStart(`${Number(fy.slice(0, 4)) + 1}`);
    const skipped: ComputeResult['skipped'] = [];
    let lines = 0;
    for (const [sellerOrgId, balance] of await availableBalances(tx, cutoffAt)) {
      const skip = (reason: string) => skipped.push({ sellerOrgId, reason });
      if (balance <= 0) {
        if (balance < 0) skip('negative_balance');
        continue;
      }
      if (balance < cfg.minPayoutPaise) { skip('below_minimum'); continue; }
      if (unsettled.has(sellerOrgId)) { skip('previous_payout_unsettled'); continue; }
      const standing = await getSellerStanding(tx, sellerOrgId);
      if (standing?.kycStatus !== 'verified') { skip('kyc_not_verified'); continue; }
      if (!(await getVerifiedBankDetails(tx, sellerOrgId))) { skip('bank_not_verified'); continue; }

      // Earlier payouts to this seller for periods in the same financial year (failed ones paid nothing).
      const [fyRow] = await tx
        .select({ total: sql<string>`coalesce(sum(${payouts.royaltyBasePaise}), 0)` })
        .from(payouts)
        .innerJoin(payoutBatches, eq(payoutBatches.id, payouts.batchId))
        .where(
          and(eq(payouts.sellerOrgId, sellerOrgId), ne(payouts.status, 'failed'), gt(payoutBatches.cutoffAt, fyFrom), lte(payoutBatches.cutoffAt, fyTo)),
        );
      const fyBefore = Number(fyRow!.total);
      const line = computePayoutLine({ basePaise: balance, hasPan: standing.hasPan, gstRegistered: standing.gstRegistered, fyPaidBeforePaise: fyBefore }, cfg);
      await tx.insert(payouts).values({ batchId: batch!.id, sellerOrgId, rail: 'bank_file', ...line });
      lines++;
    }
    const [computed] = await tx
      .update(payoutBatches)
      .set({ status: 'computed', updatedAt: new Date() })
      .where(and(eq(payoutBatches.id, batch!.id), eq(payoutBatches.status, 'draft')))
      .returning();
    await audit(tx, admin?.userId ?? null, 'payout_batch.compute', batch!.id, { period, cutoffAt, lines, skipped });
    return { batch: computed!, created: true, lines, skipped };
  });
}

/** Start of the financial year beginning in `fy`'s first four digits (1 April 00:00 IST). */
function fyStart(fy: string): Date {
  return new Date(Date.UTC(Number(fy.slice(0, 4)), 3, 1) - 330 * 60_000);
}

/** computed → approved by finance (the AdminContext carries the AAL2 check). */
export async function approvePayoutBatch(db: DbOrTx, admin: AdminContext, batchId: string): Promise<boolean> {
  requirePermission(admin, 'finance');
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(payoutBatches)
      .set({ status: 'approved', approvedBy: admin.userId, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.status, 'computed')))
      .returning({ id: payoutBatches.id });
    if (rows.length) await audit(tx, admin.userId, 'payout_batch.approve', batchId, {});
    return rows.length > 0;
  });
}

/**
 * approved → processing, then every pending payout goes to the rail and moves to processing. Safe to re-run on a
 * processing batch: only payouts still pending are sent, and the rail is keyed by payout id.
 */
export async function submitPayoutBatch(
  db: DbOrTx,
  admin: AdminContext,
  batchId: string,
  rail: PayoutRail,
): Promise<{ submitted: number; held: string[]; railRef: string | null }> {
  requirePermission(admin, 'finance');
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(payoutBatches)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.status, 'approved')))
      .returning({ id: payoutBatches.id });
    if (moved.length) await audit(tx, admin.userId, 'payout_batch.submit', batchId, { rail: rail.id });
  });
  const [batch] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, batchId));
  if (batch?.status !== 'processing') throw new Error(`batch is ${batch?.status ?? 'missing'}, not approved`);
  const pending = await db.select().from(payouts).where(and(eq(payouts.batchId, batchId), eq(payouts.status, 'pending')));
  if (pending.length === 0) return { submitted: 0, held: [], railRef: batch.railFileKey };

  // A line whose bank account lost its verification since compute is held back (left pending) rather than
  // blocking the batch; finance re-verifies and submits again, or fails the line to drop it.
  const lines: RailLine[] = [];
  const held: string[] = [];
  for (const p of pending) {
    const bank = await getVerifiedBankDetails(db, p.sellerOrgId);
    if (bank) lines.push({ payoutId: p.id, netPaise: p.netPaise, ...bank, reference: p.id });
    else held.push(p.id);
  }
  if (lines.length === 0) return { submitted: 0, held, railRef: batch.railFileKey };
  const { railRef } = await rail.submit({ batchId, period: batch.period, lines });
  await db.transaction(async (tx) => {
    await tx.update(payoutBatches).set({ railFileKey: railRef, updatedAt: new Date() }).where(eq(payoutBatches.id, batchId));
    const moved = await tx
      .update(payouts)
      .set({ status: 'processing', railRef, updatedAt: new Date() })
      .where(and(eq(payouts.batchId, batchId), eq(payouts.status, 'pending'), inArray(payouts.id, lines.map((l) => l.payoutId))))
      .returning({ id: payouts.id });
    for (const m of moved) await auditPayout(tx, admin.userId, m.id, 'pending', 'processing', { railRef });
  });
  return { submitted: lines.length, held, railRef };
}

const auditPayout = (tx: DbOrTx, actor: string, id: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
  writeAudit(tx, { actorUserId: actor, action: `payout.${to}`, entityType: 'payout', entityId: id, before: { status: from }, after: { status: to, ...extra } });

async function completeBatchIfSettled(tx: DbOrTx, batchId: string, actor: string): Promise<void> {
  const [open] = await tx.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.batchId, batchId), inArray(payouts.status, ['pending', 'processing']))).limit(1);
  if (open) return;
  const done = await tx
    .update(payoutBatches)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(and(eq(payoutBatches.id, batchId), eq(payoutBatches.status, 'processing')))
    .returning({ id: payoutBatches.id });
  if (done.length) await audit(tx, actor, 'payout_batch.complete', batchId, {});
}

export type RecordResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_processing' };

/**
 * Finance records the bank's UTR: processing → paid and the `payout` ledger debit for the royalty base, in one
 * transaction (one debit per payout, enforced by a unique index). The seller is emailed; the statement PDF is
 * rendered after commit and re-renderable.
 */
export async function recordPayoutPaid(db: DbOrTx, admin: AdminContext, payoutId: string, utr: string, store?: ObjectStore): Promise<RecordResult> {
  requirePermission(admin, 'finance');
  const cleanUtr = utr.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,30}$/.test(cleanUtr)) throw new Error('invalid UTR');
  const res = await db.transaction(async (tx) => {
    const [p] = await tx
      .update(payouts)
      .set({ status: 'paid', utr: cleanUtr, paidAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'processing')))
      .returning();
    if (!p) {
      const [any] = await tx.select({ id: payouts.id }).from(payouts).where(eq(payouts.id, payoutId));
      return { ok: false, reason: any ? 'not_processing' : 'not_found' } as const;
    }
    const [batch] = await tx.select().from(payoutBatches).where(eq(payoutBatches.id, p.batchId));
    await debitPayout(tx, { payoutId: p.id, sellerOrgId: p.sellerOrgId, amountPaise: p.royaltyBasePaise, cutoffAt: batch!.cutoffAt, createdBy: admin.userId });
    await auditPayout(tx, admin.userId, p.id, 'processing', 'paid', { utr: cleanUtr, netPaise: p.netPaise });
    const standing = await getSellerStanding(tx, p.sellerOrgId);
    if (standing?.opsContactEmail) {
      await enqueueEmail(tx, { kind: 'payout.paid', to: standing.opsContactEmail, template: 'payout_paid', payload: { period: batch!.period, netPaise: p.netPaise, utr: cleanUtr } });
    }
    await completeBatchIfSettled(tx, p.batchId, admin.userId);
    return { ok: true } as const;
  });
  if (res.ok && store) await storePayoutStatement(db, payoutId, store);
  return res;
}

/** pending | processing → failed. Nothing is written to the ledger, so the balance carries into the next run (PLAN §5.6). */
export async function recordPayoutFailed(db: DbOrTx, admin: AdminContext, payoutId: string, reason: string): Promise<RecordResult> {
  requirePermission(admin, 'finance');
  return db.transaction(async (tx) => {
    const [cur] = await tx.select({ status: payouts.status }).from(payouts).where(eq(payouts.id, payoutId)).for('update');
    if (!cur) return { ok: false, reason: 'not_found' } as const;
    // A pending line can be failed too, which drops it from a batch it would otherwise hold up.
    const [p] = await tx
      .update(payouts)
      .set({ status: 'failed', failureReason: reason.slice(0, 500), updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), inArray(payouts.status, ['pending', 'processing'])))
      .returning();
    if (!p) return { ok: false, reason: 'not_processing' } as const;
    await auditPayout(tx, admin.userId, p.id, cur.status, 'failed', { reason });
    await completeBatchIfSettled(tx, p.batchId, admin.userId);
    return { ok: true } as const;
  });
}

/** Statement PDF for a paid payout, stored once (write-once key). */
export async function storePayoutStatement(db: DbOrTx, payoutId: string, store: ObjectStore): Promise<string | null> {
  const [p] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p || p.status !== 'paid') return null;
  if (p.statementPdfKey) return p.statementPdfKey;
  const [batch] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, p.batchId));
  const [org] = await db.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, p.sellerOrgId));
  const pdf = await renderPayoutStatement({
    sellerName: org!.name,
    period: batch!.period,
    utr: p.utr!,
    paidAt: p.paidAt!,
    royaltyBasePaise: p.royaltyBasePaise,
    tdsPaise: p.tdsPaise,
    sellerGstPaise: p.sellerGstPaise,
    rcmGstPaise: p.rcmGstPaise,
    netPaise: p.netPaise,
  });
  const key = `statements/${batch!.period}/${p.id}.pdf`;
  await store.upload(BUCKETS.pdfs, key, pdf, 'application/pdf');
  await db.update(payouts).set({ statementPdfKey: key }).where(and(eq(payouts.id, payoutId), isNull(payouts.statementPdfKey)));
  return key;
}

async function listPaidPayoutsWithoutStatement(db: DbOrTx, limit = 50): Promise<string[]> {
  return (await db.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.status, 'paid'), isNull(payouts.statementPdfKey))).limit(limit)).map((r) => r.id);
}

/**
 * The daily payouts cron: on PAYOUT_DAY_OF_MONTH (IST) it computes the previous month's batch as a system
 * action (idempotent per period); every day it renders statements that are missing.
 */
export async function runPayoutsCron(db: DbOrTx, store: ObjectStore, now: Date = new Date()) {
  const day = getEnv().PAYOUT_DAY_OF_MONTH;
  if (day === undefined) throw new Error('PAYOUT_DAY_OF_MONTH is not configured');
  const computed = istDayOfMonth(now) === day ? await computePayoutBatch(db, null, previousPeriod(now)) : null;
  let statements = 0;
  for (const id of await listPaidPayoutsWithoutStatement(db)) if (await storePayoutStatement(db, id, store)) statements++;
  return { period: computed?.batch.period ?? null, created: computed?.created ?? false, lines: computed?.lines ?? 0, statements };
}
