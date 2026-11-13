import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, chargebacks, creditNotes, invoices, ledgerEntries, licenses, orders, outbox, refunds, tracks } from '@/db/schema';
import { sellerBalance } from '@/lib/ledger/server';
import { createRefundRequest } from '@/lib/payments/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { adminCtx, deliver, sale, setupCommerce } from '@/tests/commerce';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { executeRefund, requestRefund, sweepOrders } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
const deps = { gateway: gw, store };
const PRICE = 100_000;

beforeAll(() => setupCommerce(db, { L1: PRICE, L2: PRICE, L3: PRICE, L4: PRICE, L5: PRICE }));

const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};
const order = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
const refundOf = async (orderId: string) => (await db.select().from(refunds).where(eq(refunds.orderId, orderId)))[0]!;
const finance = () => adminCtx(db, ['finance']);

async function refunded(orderId: string) {
  const r = await requestRefund(db, await finance(), orderId, { reason: 'claim_not_released' });
  if (!r.ok) throw new Error(r.reason);
  return { refundId: r.refundId, run: await executeRefund(db, r.refundId, deps) };
}

describe('refunds (PLAN 5.4)', () => {
  it('a full refund issues a credit note, revokes the license and reverses the royalty, together', async () => {
    const s = await sale(db, gw, store);
    const { refundId, run } = await refunded(s.orderId);
    expect(run).toBe('processed');

    expect(await order(s.orderId)).toMatchObject({ status: 'refunded' });
    expect(await refundOf(s.orderId)).toMatchObject({ id: refundId, status: 'processed', amountPaise: (await order(s.orderId)).totalPaise });
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, s.orderId));
    const [note] = await db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv!.id));
    expect(note).toMatchObject({ refundId, taxablePaise: inv!.taxablePaise, cgstPaise: inv!.cgstPaise, igstPaise: inv!.igstPaise, totalPaise: inv!.totalPaise });
    expect(note!.number).toMatch(/^MCN\/\d{2}-\d{2}\/\d{6}$/);
    expect(store.files.get(`pdfs/${note!.pdfKey}`)!.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await db.select().from(licenses).where(eq(licenses.orderId, s.orderId)))[0]).toMatchObject({ status: 'revoked', revokedReason: 'refund' });

    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, s.orderId));
    const credit = entries.find((e) => e.kind === 'sale_royalty')!;
    expect(entries.find((e) => e.kind === 'refund_reversal')).toMatchObject({ amountPaise: -credit.amountPaise, availableAt: credit.availableAt }); // still on hold: nets at maturity
    expect(await sellerBalance(db, s.sellerOrgId, new Date(credit.availableAt.getTime() + 1))).toBe(0);

    expect(await db.select().from(outbox).where(and(eq(outbox.kind, 'refund.processed'), eq(outbox.to, s.buyer.owner.email!)))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, s.orderId), eq(auditLog.action, 'order.refund')))).toHaveLength(1);
    expect(await dbMessage(sql`UPDATE credit_notes SET total_paise = 1 WHERE id = ${note!.id}`)).toMatch(/immutable/);
  });

  it('a refund can never exceed (or fall short of) the order total, and there is one per order', async () => {
    const s = await sale(db, gw, store);
    const total = (await order(s.orderId)).totalPaise;
    for (const amount of [total + 1, total - 1, 1]) {
      expect(await dbMessage(sql`INSERT INTO refunds (id, order_id, reason, amount_paise) VALUES (gen_random_uuid(), ${s.orderId}, 'platform_error', ${amount})`)).toMatch(/full refunds only/);
    }
    const a = await requestRefund(db, await finance(), s.orderId, { reason: 'platform_error' });
    const b = await requestRefund(db, await finance(), s.orderId, { reason: 'platform_error' });
    expect(a.ok && b.ok && a.refundId === b.refundId).toBe(true);
    await expect(requestRefund(db, await adminCtx(db, ['disputes']), s.orderId, { reason: 'platform_error' })).rejects.toThrow(/finance/);
  });

  it('only fulfilled (or refund-pending) orders can be refunded', async () => {
    const s = await sale(db, gw, store, { fulfil: false });
    const r = await requestRefund(db, await finance(), s.orderId, { reason: 'platform_error' });
    expect(r).toEqual({ ok: false, reason: 'not_refundable', status: 'paid' });
  });

  it('a run that dies after Razorpay accepted the refund never refunds twice', async () => {
    const s = await sale(db, gw, store);
    const r = await requestRefund(db, await finance(), s.orderId, { reason: 'platform_error' });
    if (!r.ok) throw new Error();
    const before = gw.refundCalls;
    gw.dieAfterNextRefund = true;
    await expect(executeRefund(db, r.refundId, deps)).rejects.toThrow(/connection reset/);
    expect(await refundOf(s.orderId)).toMatchObject({ status: 'processing', claimedAt: null });
    expect(await executeRefund(db, r.refundId, deps)).toBe('processed');
    expect(gw.refundCalls - before).toBe(1);
    expect(await order(s.orderId)).toMatchObject({ status: 'refunded' });
  });

  it('a pending refund is completed by the refund.processed webhook, once', async () => {
    const s = await sale(db, gw, store);
    gw.refundOutcome = 'pending';
    try {
      expect((await refunded(s.orderId)).run).toBe('pending');
    } finally {
      gw.refundOutcome = 'processed';
    }
    expect((await order(s.orderId)).status).toBe('refund_pending');
    const refundId = (await refundOf(s.orderId)).id;
    const gr = [...gw.refunds.values()].find((x) => x.receipt === refundId)!;
    const w = gw.refundEvent('refund.processed', gr);
    await deliver(db, gw, w);
    await deliver(db, gw, w);
    await deliver(db, gw, gw.refundEvent('refund.processed', gr)); // a second delivery under a new event id
    expect(await order(s.orderId)).toMatchObject({ status: 'refunded' });
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, s.orderId));
    expect(await db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv!.id))).toHaveLength(1);
    expect((await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.orderId, s.orderId), eq(ledgerEntries.kind, 'refund_reversal'))))).toHaveLength(1);
    await sweepOrders(db, deps); // credit-note PDF rendered by the sweep
    expect((await db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv!.id)))[0]!.pdfKey).not.toBeNull();
  });

  it('a failed refund alerts ops and can be retried', async () => {
    const s = await sale(db, gw, store);
    gw.refundOutcome = 'failed';
    try {
      expect((await refunded(s.orderId)).run).toBe('failed');
    } finally {
      gw.refundOutcome = 'processed';
    }
    const failed = await refundOf(s.orderId);
    expect(failed).toMatchObject({ status: 'failed' });
    expect(await db.select().from(outbox).where(eq(outbox.kind, 'alert.refund_failed'))).not.toHaveLength(0);
    // Razorpay keeps the failed refund under our receipt; the retry must make a new one, not trip over the old.
    const before = gw.refundCalls;
    expect(await executeRefund(db, failed.id, deps)).toBe('processed');
    expect(gw.refundCalls - before).toBe(1);
    expect([...gw.refunds.values()].filter((r) => r.receipt === failed.id).map((r) => r.status).sort()).toEqual(['failed', 'processed']);
    expect(await order(s.orderId)).toMatchObject({ status: 'refunded' });
    const actions = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, failed.id))).map((r) => r.a);
    expect(actions).toEqual(expect.arrayContaining(['refund.processing', 'refund.failed', 'refund.processed']));
  });

  it('a refund whose order is not awaiting it rolls back: no credit note, revocation or reversal', async () => {
    const s = await sale(db, gw, store);
    const total = (await order(s.orderId)).totalPaise;
    // A refund row on a still-fulfilled order (bypassing requestRefund) stands in for any order-state conflict.
    const refund = await createRefundRequest(db, { orderId: s.orderId, reason: 'platform_error', amountPaise: total, requestedBy: null });
    await expect(executeRefund(db, refund.id, deps)).rejects.toThrow(/not refund_pending/);
    expect(await refundOf(s.orderId)).toMatchObject({ status: 'processing', claimedAt: null });
    expect(await order(s.orderId)).toMatchObject({ status: 'fulfilled' });
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, s.orderId));
    expect(await db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv!.id))).toHaveLength(0);
    expect((await db.select().from(licenses).where(eq(licenses.orderId, s.orderId)))[0]!.status).toBe('active');
    expect(await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.orderId, s.orderId), eq(ledgerEntries.kind, 'refund_reversal')))).toHaveLength(0);
  });

  it('an order unsellable at fulfilment is refunded automatically: no invoice, so no credit note', async () => {
    const s = await sale(db, gw, store, { fulfil: false });
    await db.update(tracks).set({ status: 'suspended' }).where(eq(tracks.id, s.trackId));
    await sweepOrders(db, deps); // fulfil → refund_pending + queued refund; then the refund runs
    expect(await order(s.orderId)).toMatchObject({ status: 'refunded' });
    expect(await refundOf(s.orderId)).toMatchObject({ status: 'processed', reason: 'unsellable_at_fulfilment', requestedBy: null });
    expect(await db.select().from(invoices).where(eq(invoices.orderId, s.orderId))).toHaveLength(0);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, s.orderId))).toHaveLength(0);
  });

  it('credit note numbers are consecutive under concurrent refunds', async () => {
    const sales = [];
    for (let i = 0; i < 6; i++) sales.push(await sale(db, gw, store));
    const fin = await finance();
    const ids = [];
    for (const s of sales) {
      const r = await requestRefund(db, fin, s.orderId, { reason: 'admin_goodwill' });
      if (r.ok) ids.push(r.refundId);
    }
    await Promise.all(ids.map((id) => executeRefund(db, id, deps)));
    const nums = (await db.select({ n: creditNotes.number }).from(creditNotes).where(sql`${creditNotes.refundId} in ${ids}`)).map((r) => Number(r.n.slice(-6))).sort((a, b) => a - b);
    expect(nums).toHaveLength(6);
    expect(nums[5]! - nums[0]!).toBe(5);
  });
});

describe('chargebacks', () => {
  const dispute = (s: { payment: { id: string; amountPaise: number } }) => ({ id: `disp_${Math.random().toString(36).slice(2)}`, paymentId: s.payment.id, amountPaise: s.payment.amountPaise });

  it('opened then won: back to fulfilled, license untouched', async () => {
    const s = await sale(db, gw, store);
    const d = dispute(s);
    await deliver(db, gw, gw.disputeEvent('created', d));
    expect((await order(s.orderId)).status).toBe('charged_back_pending');
    await deliver(db, gw, gw.disputeEvent('won', d));
    expect((await order(s.orderId)).status).toBe('fulfilled');
    expect((await db.select().from(licenses).where(eq(licenses.orderId, s.orderId)))[0]!.status).toBe('active');
    expect((await db.select().from(chargebacks).where(eq(chargebacks.gatewayDisputeId, d.id)))[0]!.status).toBe('won');
  });

  it('lost (even without a created event): revoked, royalty reversed, once', async () => {
    const s = await sale(db, gw, store);
    const d = dispute(s);
    const lost = gw.disputeEvent('lost', d);
    await deliver(db, gw, lost);
    await deliver(db, gw, gw.disputeEvent('lost', d));
    expect((await order(s.orderId)).status).toBe('charged_back');
    expect((await db.select().from(licenses).where(eq(licenses.orderId, s.orderId)))[0]).toMatchObject({ status: 'revoked', revokedReason: 'chargeback_lost' });
    expect(await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.orderId, s.orderId), eq(ledgerEntries.kind, 'chargeback_reversal')))).toHaveLength(1);
    expect(await db.select().from(outbox).where(eq(outbox.kind, 'alert.chargeback_opened'))).not.toHaveLength(0);
    const [cb] = await db.select().from(chargebacks).where(eq(chargebacks.gatewayDisputeId, d.id));
    const actions = (await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, cb!.id))).map((r) => r.a).sort();
    expect(actions).toEqual(['chargeback.lost', 'chargeback.open']);
  });
});
