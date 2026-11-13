import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, ledgerEntries, payoutAccounts, payoutBatches, payouts, sellerProfiles } from '@/db/schema';
import { sellerBalance } from '@/lib/ledger/server';
import { executeRefund, requestRefund } from '@/lib/orders/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { getPayoutAccount, setPayoutAccount, verifyPayoutAccount } from '@/lib/sellers/server';
import { adminCtx, sale, setupCommerce } from '@/tests/commerce';
import { makeSeller, makeUser } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import {
  BankFileRail,
  approvePayoutBatch,
  computePayoutBatch,
  computePayoutLine,
  csvCell,
  periodCutoff,
  previousPeriod,
  recordPayoutFailed,
  recordPayoutPaid,
  runPayoutsCron,
  submitPayoutBatch,
} from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
const rail = new BankFileRail(store);
const DAY = 86_400_000;

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 200_000, L3: 300_000, L4: 400_000, L5: 5_000_000 }));

const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};
const finance = () => adminCtx(db, ['finance']);

/**
 * Payout periods must run in order, so each test takes the next past period (three months on, leaving room for a
 * test's nextPeriod()). Starts in 1980: before ~1945 a server in Asia/Calcutta reports historic offsets with seconds
 * (e.g. +05:21:10), which JavaScript dates cannot parse. Needs a fresh database, as CI has.
 */
let periodSeq = 0;
const pastPeriod = () => {
  const n = periodSeq;
  periodSeq += 3;
  return `${1980 + Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
};
const nextPeriod = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** A seller ready to be paid: KYC verified, bank account set (AAL2) and verified by finance. */
async function payableSeller(opts: { pan?: boolean; gstRegistered?: boolean } = {}) {
  const s = await makeSeller(db);
  await setPayoutAccount(db, { ...s.owner, aal: 'aal2' }, s.orgId, { accountNumber: '123456789012', ifsc: 'HDFC0001234', accountHolderName: 'Seller Pvt Ltd' });
  await verifyPayoutAccount(db, await finance(), s.orgId, true);
  await db.update(sellerProfiles).set({ panEncrypted: opts.pan === false ? null : 'enc-pan', gstRegistered: opts.gstRegistered ?? false }).where(eq(sellerProfiles.orgId, s.orgId));
  return s.orgId;
}
const lineFor = async (batchId: string, sellerOrgId: string) =>
  (await db.select().from(payouts).where(and(eq(payouts.batchId, batchId), eq(payouts.sellerOrgId, sellerOrgId))))[0];

async function payBatch(period: string, utrPrefix = 'UTR') {
  const fin = await finance();
  const c = await computePayoutBatch(db, fin, period);
  await approvePayoutBatch(db, fin, c.batch.id);
  await submitPayoutBatch(db, fin, c.batch.id, rail);
  const lines = await db.select().from(payouts).where(eq(payouts.batchId, c.batch.id));
  for (const l of lines) if (l.status === 'processing') await recordPayoutPaid(db, fin, l.id, `${utrPrefix}${l.id.replaceAll('-', '').slice(0, 10).toUpperCase()}`, store);
  return c;
}

describe('payout arithmetic and periods', () => {
  const cfg = { tdsRateBps: 1000, tdsRateNoPanBps: 2000, tdsFyThresholdPaise: 3_000_000, rcmOnUnregistered: true, gstRateBps: 1800, minPayoutPaise: 10_000 };
  it.each([
    // base, PAN, GST-registered, paid earlier in FY → tds, seller GST, RCM, net
    [70_000, true, false, 0, 0, 0, 12_600, 70_000],
    [70_000, true, true, 0, 0, 12_600, 0, 82_600],
    [70_000, true, false, 2_950_000, 7_000, 0, 12_600, 63_000], // crosses the FY threshold
    [3_500_000, false, false, 0, 700_000, 0, 630_000, 2_800_000], // no PAN: higher rate
    [5, true, true, 3_000_000, 1, 1, 0, 5], // half-up: 0.5 → 1, 0.9 → 1
  ])('base %i (PAN %s, GST %s, FY so far %i) → TDS %i, GST %i, RCM %i, net %i', (base, pan, gst, before, tds, sellerGst, rcm, net) => {
    expect(computePayoutLine({ basePaise: base, hasPan: pan, gstRegistered: gst, fyPaidBeforePaise: before }, cfg)).toEqual({
      royaltyBasePaise: base,
      tdsPaise: tds,
      sellerGstPaise: sellerGst,
      rcmGstPaise: rcm,
      netPaise: net,
    });
  });

  it('periods are IST calendar months', () => {
    expect(periodCutoff('2026-03').toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(periodCutoff('2026-12').toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(previousPeriod(new Date('2026-11-13T10:00:00Z'))).toBe('2026-10');
    expect(previousPeriod(new Date('2026-11-30T18:40:00Z'))).toBe('2026-11'); // 00:10 IST on 1 December
    expect(previousPeriod(new Date('2027-01-02T00:00:00Z'))).toBe('2026-12');
    expect(() => periodCutoff('2026-13')).toThrow();
  });

  it('bank-file cells are quoted and cannot carry spreadsheet formulas', () => {
    expect(csvCell('Seller "A", Ltd')).toBe('"Seller ""A"", Ltd"');
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+91')).toBe('"\'+91"');
  });
});

describe('payout runs (PLAN 5.6)', () => {
  it('a royalty is unavailable before its 30-day hold ends', async () => {
    const period = pastPeriod();
    const cutoff = periodCutoff(period);
    const seller = await payableSeller();
    await sale(db, gw, store, { sellerOrgId: seller, paidAt: new Date(cutoff.getTime() - 10 * DAY) });
    const credit = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.sellerOrgId, seller)))[0]!;
    expect(await sellerBalance(db, seller, new Date(credit.availableAt.getTime() - 1))).toBe(0);
    expect(await sellerBalance(db, seller, credit.availableAt)).toBe(70_000);

    const c = await computePayoutBatch(db, await finance(), period);
    expect(await lineFor(c.batch.id, seller)).toBeUndefined(); // not yet available at this cutoff
    const later = await computePayoutBatch(db, await finance(), nextPeriod(period));
    expect(await lineFor(later.batch.id, seller)).toMatchObject({ royaltyBasePaise: 70_000 });
  });

  it('pays once: compute, approve, bank file, UTR, ledger debit and statement are all idempotent', async () => {
    const period = pastPeriod();
    const seller = await payableSeller();
    await sale(db, gw, store, { sellerOrgId: seller, paidAt: new Date(periodCutoff(period).getTime() - 40 * DAY) });
    const fin = await finance();

    const [a, b] = await Promise.all([computePayoutBatch(db, fin, period), computePayoutBatch(db, fin, period)]);
    expect(a.batch.id).toBe(b.batch.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    const line = (await lineFor(a.batch.id, seller))!;
    expect(line).toMatchObject({ royaltyBasePaise: 70_000, tdsPaise: 0, sellerGstPaise: 0, rcmGstPaise: 12_600, netPaise: 70_000, status: 'pending' });

    expect(await submitPayoutBatch(db, fin, a.batch.id, rail).catch((e: Error) => e.message)).toMatch(/not approved/);
    expect(await approvePayoutBatch(db, fin, a.batch.id)).toBe(true);
    expect(await approvePayoutBatch(db, fin, a.batch.id)).toBe(false);
    const first = await submitPayoutBatch(db, fin, a.batch.id, rail);
    expect(first.submitted).toBeGreaterThanOrEqual(1);
    expect((await submitPayoutBatch(db, fin, a.batch.id, rail)).submitted).toBe(0);
    const csv = store.files.get(`documents/${first.railRef}`)!.toString();
    expect(csv).toContain('"123456789012"');
    expect(csv).toContain(`"${line.id}"`);

    const utr = 'UTR00001234567';
    expect(await recordPayoutPaid(db, fin, line.id, utr, store)).toEqual({ ok: true });
    expect(await recordPayoutPaid(db, fin, line.id, utr, store)).toEqual({ ok: false, reason: 'not_processing' });
    const debits = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.payoutId, line.id), eq(ledgerEntries.kind, 'payout')));
    expect(debits).toMatchObject([{ amountPaise: -70_000 }]);
    expect(await sellerBalance(db, seller, periodCutoff(period))).toBe(0);
    const paid = (await lineFor(a.batch.id, seller))!;
    expect(paid).toMatchObject({ status: 'paid', utr });
    expect(store.files.get(`pdfs/${paid.statementPdfKey}`)!.subarray(0, 5).toString()).toBe('%PDF-');

    expect(await dbMessage(sql`UPDATE payouts SET net_paise = 1, royalty_base_paise = 1 WHERE id = ${line.id}`)).toMatch(/fixed once computed/);
    expect(await dbMessage(sql`UPDATE payouts SET status = 'pending' WHERE id = ${line.id}`)).toMatch(/paid -> pending/);
    expect(await dbMessage(sql`INSERT INTO ledger_entries (id, seller_org_id, kind, amount_paise, payout_id, available_at) VALUES (gen_random_uuid(), ${seller}, 'payout', -1, ${line.id}, now())`)).toMatch(/ledger_entries_payout_key|duplicate key/);
  });

  it('skips sellers below the minimum, without verified KYC or bank, suspended, or with an unsettled payout', async () => {
    const period = pastPeriod();
    const paidAt = new Date(periodCutoff(period).getTime() - 40 * DAY);
    const small = await payableSeller();
    await db.update(sellerProfiles).set({ royaltyRateBps: 100 }).where(eq(sellerProfiles.orgId, small)); // 1% of 1,000 = 1,000 paise
    const noKyc = await payableSeller();
    await db.update(sellerProfiles).set({ kycStatus: 'pending' }).where(eq(sellerProfiles.orgId, noKyc));
    const noBank = (await makeSeller(db)).orgId;
    const busy = await payableSeller();
    const held = await payableSeller();
    for (const seller of [small, noKyc, noBank, busy, held]) await sale(db, gw, store, { sellerOrgId: seller, paidAt });
    await db.update(sellerProfiles).set({ status: 'suspended' }).where(eq(sellerProfiles.orgId, held)); // after its sale: fulfilment refuses a suspended seller

    const fin = await finance();
    const c = await computePayoutBatch(db, fin, period);
    const reasons = Object.fromEntries(c.skipped.map((s) => [s.sellerOrgId, s.reason]));
    expect([reasons[small], reasons[noKyc], reasons[noBank], reasons[held]]).toEqual(['below_minimum', 'kyc_not_verified', 'bank_not_verified', 'seller_suspended']);
    await approvePayoutBatch(db, fin, c.batch.id);
    await submitPayoutBatch(db, fin, c.batch.id, rail); // busy's payout is now processing, not settled

    await sale(db, gw, store, { sellerOrgId: busy, paidAt });
    const next = await computePayoutBatch(db, fin, nextPeriod(period));
    expect(next.skipped).toContainEqual({ sellerOrgId: busy, reason: 'previous_payout_unsettled' });
  });

  it('periods run in order: an earlier period after a later one is refused (it would pay twice)', async () => {
    const later = pastPeriod();
    const fin = await finance();
    await computePayoutBatch(db, fin, later);
    await expect(computePayoutBatch(db, fin, '1979-12')).rejects.toThrow(/run in order/); // before every period above
    expect((await computePayoutBatch(db, fin, later)).created).toBe(false); // the same period is still idempotent
  });

  it('a line whose bank account lost verification is held back; finance can fail a pending line to drop it', async () => {
    const period = pastPeriod();
    const paidAt = new Date(periodCutoff(period).getTime() - 40 * DAY);
    const ok = await payableSeller();
    const changed = await payableSeller();
    for (const seller of [ok, changed]) await sale(db, gw, store, { sellerOrgId: seller, paidAt });
    const fin = await finance();
    const c = await computePayoutBatch(db, fin, period);
    const [owner] = await db.execute<{ user_id: string }>(sql`select user_id from memberships where org_id = ${changed} limit 1`);
    await setPayoutAccount(db, { userId: owner!.user_id, email: null, phone: null, verified: true, aal: 'aal2' }, changed, {
      accountNumber: '555566667777',
      ifsc: 'SBIN0000001',
      accountHolderName: 'Changed Ltd',
    });
    await approvePayoutBatch(db, fin, c.batch.id);
    const sub = await submitPayoutBatch(db, fin, c.batch.id, rail);
    const heldLine = (await lineFor(c.batch.id, changed))!;
    expect(sub.held).toEqual([heldLine.id]);
    expect(heldLine.status).toBe('pending');
    expect((await lineFor(c.batch.id, ok))!.status).toBe('processing');
    expect(await recordPayoutFailed(db, fin, heldLine.id, 'bank details changed after compute')).toEqual({ ok: true });

    const okLine = (await lineFor(c.batch.id, ok))!;
    await recordPayoutPaid(db, fin, okLine.id, 'UTR99990000111', store);
    const [batch] = await db.select().from(payoutBatches).where(eq(payoutBatches.id, c.batch.id));
    expect(batch!.status).toBe('completed');
    const actions = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, c.batch.id))).map((r) => r.a).sort();
    expect(actions).toEqual(['payout_batch.approve', 'payout_batch.complete', 'payout_batch.compute', 'payout_batch.submit']);
    const lineActions = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, okLine.id))).map((r) => r.a).sort();
    expect(lineActions).toEqual(['payout.paid', 'payout.processing']);
  });

  it('a failed payout writes nothing to the ledger and the balance is paid by the next run', async () => {
    const period = pastPeriod();
    const seller = await payableSeller();
    await sale(db, gw, store, { sellerOrgId: seller, paidAt: new Date(periodCutoff(period).getTime() - 40 * DAY) });
    const fin = await finance();
    const c = await computePayoutBatch(db, fin, period);
    await approvePayoutBatch(db, fin, c.batch.id);
    await submitPayoutBatch(db, fin, c.batch.id, rail);
    const line = (await lineFor(c.batch.id, seller))!;
    expect(await recordPayoutFailed(db, fin, line.id, 'account closed')).toEqual({ ok: true });
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.payoutId, line.id))).toHaveLength(0);
    const next = await computePayoutBatch(db, fin, nextPeriod(period));
    expect(await lineFor(next.batch.id, seller)).toMatchObject({ royaltyBasePaise: 70_000 });
  });

  it('TDS once the financial-year threshold is crossed; forward GST for a registered seller', async () => {
    const period = pastPeriod();
    const paidAt = new Date(periodCutoff(period).getTime() - 40 * DAY);
    const seller = await payableSeller({ pan: false, gstRegistered: true });
    await sale(db, gw, store, { sellerOrgId: seller, priceLevel: 'L5', paidAt }); // royalty 3,500,000 > 3,000,000 threshold
    const c = await computePayoutBatch(db, await finance(), period);
    expect(await lineFor(c.batch.id, seller)).toMatchObject({ royaltyBasePaise: 3_500_000, tdsPaise: 700_000, sellerGstPaise: 630_000, rcmGstPaise: 0, netPaise: 3_430_000 });
  });

  it('the cron computes the previous month only on the configured day (IST)', async () => {
    // 2019 is after every pastPeriod() used above and before the current month used by the last test.
    const onDay = await runPayoutsCron(db, store, new Date('2019-06-05T06:00:00Z'));
    expect(onDay).toMatchObject({ period: '2019-05' });
    expect((await runPayoutsCron(db, store, new Date('2019-06-05T07:00:00Z'))).created).toBe(false);
    expect((await runPayoutsCron(db, store, new Date('2019-06-06T06:00:00Z'))).period).toBeNull();
    const [batch] = await db.select().from(payoutBatches).where(eq(payoutBatches.period, '2019-05'));
    expect(batch!.status).toBe('computed');
  });

  // Last in this group: it runs the current month, after which no earlier period may be computed.
  it('refund after payout ⇒ negative balance netted against the next run (clawback)', async () => {
    const period = '2020-03'; // after the cron test's 2019-05 batch, before the current month used below
    const old = new Date(periodCutoff(period).getTime() - 40 * DAY);
    const nets = await payableSeller(); // a new sale later outweighs the clawback
    const owes = await payableSeller(); // nothing new: stays negative and is carried
    const s1 = await sale(db, gw, store, { sellerOrgId: nets, priceLevel: 'L1', paidAt: old });
    const s2 = await sale(db, gw, store, { sellerOrgId: owes, priceLevel: 'L1', paidAt: old });
    const first = await payBatch(period);
    expect((await lineFor(first.batch.id, nets))!.status).toBe('paid');

    for (const s of [s1, s2]) {
      const r = await requestRefund(db, await finance(), s.orderId, { reason: 'claim_not_released' });
      if (r.ok) await executeRefund(db, r.refundId, { gateway: gw, store });
    }
    expect(await sellerBalance(db, nets)).toBe(-70_000);
    await sale(db, gw, store, { sellerOrgId: nets, priceLevel: 'L3', paidAt: old }); // +210,000

    // The clawback is available now, so the next run that can see it is the current month's: run it as if it had ended.
    const now = new Date();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(periodCutoff(previousPeriod(new Date(now.getTime() + 35 * DAY))).getTime() + DAY));
    try {
      const run = await computePayoutBatch(db, await finance(), previousPeriod(new Date()));
      expect(await lineFor(run.batch.id, nets)).toMatchObject({ royaltyBasePaise: 210_000 - 70_000 });
      expect(await lineFor(run.batch.id, owes)).toBeUndefined();
      expect(run.skipped).toContainEqual({ sellerOrgId: owes, reason: 'negative_balance' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('payout accounts', () => {
  it('changes need AAL2 and an owner; stored encrypted, shown masked; a change clears verification', async () => {
    const s = await makeSeller(db);
    const input = { accountNumber: '987654321098', ifsc: 'icic0004321', accountHolderName: 'Seller Pvt Ltd' };
    await expect(setPayoutAccount(db, s.owner, s.orgId, input)).rejects.toThrow(/mfa_required/);
    const stranger = await makeUser(db, { aal: 'aal2' });
    await expect(setPayoutAccount(db, stranger, s.orgId, input)).rejects.toThrow(/forbidden/);
    await setPayoutAccount(db, { ...s.owner, aal: 'aal2' }, s.orgId, input);
    const [raw] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.sellerOrgId, s.orgId));
    expect(raw!.accountNumberEncrypted).not.toContain('987654321098');
    expect(await getPayoutAccount(db, s.orgId)).toEqual({ maskedAccount: 'XXXXXXXX1098', ifsc: 'ICIC0004321', accountHolderName: 'Seller Pvt Ltd', verified: false });
    await verifyPayoutAccount(db, await finance(), s.orgId, true);
    expect((await getPayoutAccount(db, s.orgId))!.verified).toBe(true);
    await setPayoutAccount(db, { ...s.owner, aal: 'aal2' }, s.orgId, { ...input, accountNumber: '111122223333' });
    expect((await getPayoutAccount(db, s.orgId))!.verified).toBe(false);
    await expect(setPayoutAccount(db, { ...s.owner, aal: 'aal2' }, s.orgId, { ...input, ifsc: 'BAD' })).rejects.toThrow(/IFSC/);
  });
});
