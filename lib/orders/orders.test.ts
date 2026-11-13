import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import { auditLog, certificates, invoices, ledgerEntries, licenses, orderEvents, orders, outbox, paymentEvents, reconciliationItems, sellerProfiles, tracks } from '@/db/schema';
import { PRICE_LEVELS } from '@/lib/catalog';
import { getVerifyView } from '@/lib/certificates/server';
import type { AdminPermission } from '@/lib/identity';
import { isValidGstin } from '@/lib/invoicing';
import { acceptPending, publishLegalDocument } from '@/lib/legal/server';
import { TIERS, issueDownloadUrl, publishTermsVersion, revokeLicense, type Tier } from '@/lib/licensing/server';
import { recordPaymentEvent } from '@/lib/payments/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { activatePriceBook, createPriceBook } from '@/lib/pricing/server';
import { makeBuyer, makeSellableTrack, makeUser } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import {
  createOrder,
  expireIfUnpaid,
  fulfilOrder,
  handleRazorpayWebhook,
  reconcilePayments,
  reconcilePreviousDay,
  sweepOrders,
  verifyCheckoutCallback,
  type BuyerSession,
} from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
const deps = { gateway: gw, store };

const adminCtx = async (permissions: AdminPermission[]) => ({ userId: (await makeUser(db, { admin: permissions, aal: 'aal2' })).userId, permissions });
const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};

const PRICE = 50_000; // L2 creator in the book below

beforeAll(async () => {
  const sa = await adminCtx(['superadmin']);
  for (const kind of ['tos', 'privacy'] as const) await publishLegalDocument(db, sa, { kind, bodyMarkdown: `${kind} for orders tests` });
  for (const tier of TIERS) {
    const text = await publishLegalDocument(db, sa, { kind: `license_${tier}`, bodyMarkdown: `${tier} license text` });
    await publishTermsVersion(db, sa, {
      tier,
      termKind: tier === 'paid_ad' ? 'fixed_months' : 'perpetual',
      termMonths: tier === 'paid_ad' ? 12 : null,
      videoCap: { creator: 1, brand_organic: 3, paid_ad: null }[tier],
      maxChannels: 3,
      allowedPlatforms: ['youtube', 'instagram', 'facebook'],
      organicOnly: tier !== 'paid_ad',
      licenseTextDocumentId: text.id,
    });
  }
  const a = await adminCtx(['verification']);
  const book = await createPriceBook(db, a, PRICE_LEVELS.flatMap((priceLevel) => TIERS.map((tier) => ({ priceLevel, tier, amountPaise: PRICE }))));
  await activatePriceBook(db, a, book.id);
});

async function buyer(type: 'individual' | 'business' | 'agency' = 'business', name = 'Buyer Media LLP', accept = true) {
  const b = await makeBuyer(db, name, type);
  if (accept) await acceptPending(db, { userId: b.owner.userId, kinds: ['tos', 'privacy'] });
  const session: BuyerSession = { userId: b.owner.userId, orgId: b.orgId, email: b.owner.email };
  return { ...b, session };
}

async function checkout(opts: { tier?: Tier; billing?: string; gstin?: string; b?: Awaited<ReturnType<typeof buyer>>; clientName?: string; key?: string } = {}) {
  const track = await makeSellableTrack(db);
  const b = opts.b ?? (await buyer());
  const r = await createOrder(
    db,
    b.session,
    {
      trackId: track.trackId,
      tier: opts.tier ?? 'creator',
      channels: [{ platform: 'youtube', handleOrUrl: '@buyer' }],
      billingStateCode: opts.billing ?? '27',
      gstin: opts.gstin,
      clientName: opts.clientName,
      idempotencyKey: opts.key ?? `key-${Math.random()}`,
    },
    gw,
  );
  if (!r.ok) throw new Error(r.issues.join());
  return { ...r.value, gatewayOrderId: r.value.gatewayOrderId!, track, b };
}

const deliver = (w: { rawBody: string; signature: string; eventId: string }) =>
  handleRazorpayWebhook(db, { rawBody: w.rawBody, signature: w.signature, eventId: w.eventId }, gw);

async function counts(orderId: string) {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]!.n;
  const [license] = await db.select({ id: licenses.id }).from(licenses).where(eq(licenses.orderId, orderId));
  return {
    licenses: await n(db.select({ n: count() }).from(licenses).where(eq(licenses.orderId, orderId))),
    invoices: await n(db.select({ n: count() }).from(invoices).where(eq(invoices.orderId, orderId))),
    ledger: await n(db.select({ n: count() }).from(ledgerEntries).where(eq(ledgerEntries.orderId, orderId))),
    certificates: license ? await n(db.select({ n: count() }).from(certificates).where(eq(certificates.licenseId, license.id))) : 0,
    captures: await n(db.select({ n: count() }).from(orderEvents).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.event, 'capture')))),
  };
}
const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
const ONE_EACH = { licenses: 1, invoices: 1, ledger: 1, certificates: 1, captures: 1 };

describe('createOrder', () => {
  it('snapshots price and GST server-side: intra-state CGST+SGST, inter-state IGST', async () => {
    const intra = await checkout({ billing: '27' });
    expect(await orderRow(intra.orderId)).toMatchObject({ status: 'awaiting_payment', taxablePaise: PRICE, cgstPaise: 4_500, sgstPaise: 4_500, igstPaise: 0, totalPaise: 59_000 });
    const inter = await checkout({ billing: '29' });
    expect(await orderRow(inter.orderId)).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 9_000, totalPaise: 59_000 });
    // A Karnataka GSTIN overrides a Maharashtra billing state: inter-state.
    const gstin = [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((ch) => `29AAACB1234C1Z${ch}`).find(isValidGstin)!;
    const byGstin = await checkout({ billing: '27', gstin });
    expect(await orderRow(byGstin.orderId)).toMatchObject({ igstPaise: 9_000, snapshot: { recipientGstin: gstin, placeOfSupplyState: '29' } });
    await expect(checkout({ billing: '27', gstin: 'NOTAGSTIN' })).rejects.toThrow(/invalid GSTIN/);
    expect(gw.orders.get(intra.gatewayOrderId)).toEqual({ amountPaise: 59_000, receipt: intra.orderId });
  });

  it('the same idempotency key returns the same order and opens one gateway order', async () => {
    const b = await buyer();
    const track = await makeSellableTrack(db);
    const input = { trackId: track.trackId, tier: 'creator' as const, channels: [{ platform: 'youtube' as const, handleOrUrl: '@a' }], billingStateCode: '27', idempotencyKey: 'same-key-123' };
    const before = gw.createCalls;
    const results = await Promise.all([createOrder(db, b.session, input, gw), createOrder(db, b.session, input, gw), createOrder(db, b.session, input, gw)]);
    const ids = new Set(results.map((r) => (r.ok ? r.value.orderId : r.issues.join())));
    expect(ids.size).toBe(1);
    const gids = new Set(results.map((r) => (r.ok ? r.value.gatewayOrderId : null)));
    expect(gids.size).toBe(1);
    expect(gw.createCalls - before).toBeGreaterThanOrEqual(1);
    expect((await createOrder(db, b.session, input, gw)).ok).toBe(true);
  });

  it('a gateway outage leaves the order created; the same key resumes it', async () => {
    const b = await buyer();
    const track = await makeSellableTrack(db);
    const input = { trackId: track.trackId, tier: 'creator' as const, channels: [{ platform: 'youtube' as const, handleOrUrl: '@a' }], billingStateCode: '27', idempotencyKey: 'outage-key-1' };
    gw.failCreate = true;
    expect(await createOrder(db, b.session, input, gw)).toEqual({ ok: false, issues: ['payment_gateway_unavailable'] });
    gw.failCreate = false;
    const r = await createOrder(db, b.session, input, gw);
    expect(r).toMatchObject({ ok: true, value: { status: 'awaiting_payment' } });
  });

  it('refuses until the current ToS is accepted, and checks buyer, channels and client name', async () => {
    const fresh = await buyer('business', 'New Co', false);
    const track = await makeSellableTrack(db);
    const base = { trackId: track.trackId, tier: 'creator' as const, channels: [{ platform: 'youtube' as const, handleOrUrl: '@a' }], billingStateCode: '27' };
    expect(await createOrder(db, fresh.session, { ...base, idempotencyKey: 'tos-key-1' }, gw)).toEqual({ ok: false, issues: ['terms_not_accepted'] });

    const biz = await buyer();
    expect(await createOrder(db, biz.session, { ...base, clientName: 'Client Co', idempotencyKey: 'client-key-1' }, gw)).toEqual({ ok: false, issues: ['client_name_agency_only'] });
    const four = ['a', 'b', 'c', 'd'].map((h) => ({ platform: 'youtube' as const, handleOrUrl: h }));
    expect(await createOrder(db, biz.session, { ...base, channels: four, idempotencyKey: 'chan-key-1' }, gw)).toEqual({ ok: false, issues: ['too_many_channels'] });
    expect(await createOrder(db, { ...biz.session, orgId: fresh.orgId }, { ...base, idempotencyKey: 'org-key-1' }, gw)).toEqual({ ok: false, issues: ['not_found'] });
  });

  it('agency purchase: the client is the licensee; the snapshot is immutable', async () => {
    const agency = await buyer('agency', 'Agency Pvt Ltd');
    const c = await checkout({ b: agency, clientName: 'Client Brand' });
    const row = await orderRow(c.orderId);
    expect(row.snapshot).toMatchObject({ licenseeName: 'Client Brand', clientName: 'Client Brand', recipientName: 'Agency Pvt Ltd' });
    expect(await dbMessage(sql`UPDATE orders SET total_paise = 1, taxable_paise = 1 WHERE id = ${c.orderId}`)).toMatch(/snapshot is immutable/);
    expect(await dbMessage(sql`UPDATE orders SET status = 'fulfilled' WHERE id = ${c.orderId}`)).toMatch(/awaiting_payment -> fulfilled/);
  });
});

describe('payment and fulfilment (exit criteria)', () => {
  it('duplicate webhook ⇒ one license, invoice and ledger entry', async () => {
    const c = await checkout();
    const p = gw.pay(c.gatewayOrderId);
    const w = gw.webhook('payment.captured', p);
    const first = await deliver(w);
    expect(first).toEqual({ status: 200, fulfilOrderId: c.orderId });
    expect(await deliver(w)).toEqual({ status: 200 });
    await Promise.all([deliver(w), deliver(w), deliver(gw.webhook('order.paid', p))]);
    await Promise.all([fulfilOrder(db, c.orderId, store), fulfilOrder(db, c.orderId, store)]);
    await fulfilOrder(db, c.orderId, store);

    expect((await orderRow(c.orderId)).status).toBe('fulfilled');
    expect(await counts(c.orderId)).toEqual(ONE_EACH);
    expect(await db.select().from(paymentEvents).where(eq(paymentEvents.gatewayEventId, w.eventId))).toHaveLength(1);
  });

  it('callback and webhook racing ⇒ one capture and one fulfilment', async () => {
    const c = await checkout();
    const p = gw.pay(c.gatewayOrderId);
    const cb = verifyCheckoutCallback(db, c.b.session, { orderId: c.orderId, paymentId: p.id, gatewayOrderId: c.gatewayOrderId, signature: gw.callbackSignature(c.gatewayOrderId, p.id) }, gw);
    const [callback, hook] = await Promise.all([cb, deliver(gw.webhook('payment.captured', p))]);
    expect(callback).toMatchObject({ ok: true, status: 'paid' });
    expect([callback.ok && callback.fulfil, !!hook.fulfilOrderId].filter(Boolean)).toHaveLength(1); // exactly one path kicks fulfilment
    await Promise.all([fulfilOrder(db, c.orderId, store), fulfilOrder(db, c.orderId, store), sweepOrders(db, deps)]);
    expect(await counts(c.orderId)).toEqual(ONE_EACH);
  });

  it('a forged callback signature or a webhook with a bad HMAC changes nothing', async () => {
    const c = await checkout();
    const p = gw.pay(c.gatewayOrderId);
    expect(
      await verifyCheckoutCallback(db, c.b.session, { orderId: c.orderId, paymentId: p.id, gatewayOrderId: c.gatewayOrderId, signature: 'f'.repeat(64) }, gw),
    ).toEqual({ ok: false, reason: 'invalid_signature' });
    const w = gw.webhook('payment.captured', p);
    expect(await deliver({ ...w, signature: w.signature.replace(/.$/, w.signature.endsWith('0') ? '1' : '0') })).toEqual({ status: 401 });
    expect(await deliver({ ...w, rawBody: w.rawBody.replace(String(p.amountPaise), '1') })).toEqual({ status: 401 });
    expect(await db.select().from(paymentEvents).where(eq(paymentEvents.gatewayEventId, w.eventId))).toHaveLength(0);
    expect((await orderRow(c.orderId)).status).toBe('awaiting_payment');
    const stranger = await buyer();
    expect(
      await verifyCheckoutCallback(db, stranger.session, { orderId: c.orderId, paymentId: p.id, gatewayOrderId: c.gatewayOrderId, signature: gw.callbackSignature(c.gatewayOrderId, p.id) }, gw),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('amount mismatch ⇒ not paid, with audit, alert and reconciliation item', async () => {
    const c = await checkout();
    const p = gw.pay(c.gatewayOrderId, { amountPaise: 58_999 });
    expect(await deliver(gw.webhook('payment.captured', p))).toEqual({ status: 200 });
    expect((await orderRow(c.orderId)).status).toBe('awaiting_payment');
    expect(await db.select().from(reconciliationItems).where(eq(reconciliationItems.gatewayRef, p.id))).toMatchObject([{ kind: 'amount_mismatch', orderId: c.orderId }]);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, c.orderId), eq(auditLog.action, 'order.payment_mismatch')))).toHaveLength(1);
    expect(await db.select().from(outbox).where(eq(outbox.kind, 'alert.amount_mismatch'))).not.toHaveLength(0);
    expect(await counts(c.orderId)).toMatchObject({ licenses: 0, invoices: 0, ledger: 0, captures: 0 });
  });

  it('late capture on an expired order ⇒ fulfilled', async () => {
    const c = await checkout();
    expect(await expireIfUnpaid(db, c.orderId, gw, new Date(Date.now() + 31 * 60_000))).toEqual({ status: 'expired' });
    const r = await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    expect(r.fulfilOrderId).toBe(c.orderId);
    expect(await fulfilOrder(db, c.orderId, store)).toBe('fulfilled');
    expect(await counts(c.orderId)).toEqual(ONE_EACH);
  });

  it('expiry checks Razorpay first: a captured payment pays the order instead of expiring it', async () => {
    const c = await checkout();
    gw.pay(c.gatewayOrderId); // webhook never arrived
    expect(await expireIfUnpaid(db, c.orderId, gw, new Date(Date.now() + 31 * 60_000))).toEqual({ status: 'paid', fulfilOrderId: c.orderId });
  });

  it('a capture after a failed attempt is still paid', async () => {
    const c = await checkout();
    await deliver(gw.webhook('payment.failed', gw.pay(c.gatewayOrderId, { status: 'failed' })));
    expect((await orderRow(c.orderId)).status).toBe('failed');
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    expect((await orderRow(c.orderId)).status).toBe('paid');
  });

  it('a second payment for a paid order is flagged, not fulfilled twice', async () => {
    const c = await checkout();
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    await fulfilOrder(db, c.orderId, store);
    const second = gw.pay(c.gatewayOrderId);
    await deliver(gw.webhook('payment.captured', second));
    expect(await db.select().from(reconciliationItems).where(eq(reconciliationItems.gatewayRef, second.id))).toMatchObject([{ kind: 'duplicate_payment' }]);
    expect(await counts(c.orderId)).toEqual(ONE_EACH);
  });

  it('crash between fulfilment steps ⇒ retry completes cleanly', async () => {
    const c = await checkout();
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    store.failNext = 1; // dies rendering/storing PDFs, after the legal-facts transaction
    await expect(fulfilOrder(db, c.orderId, store)).rejects.toThrow(/storage unavailable/);
    const mid = await orderRow(c.orderId);
    expect(mid).toMatchObject({ status: 'paid', fulfilClaimedAt: null, lastError: 'storage unavailable' });
    expect(await counts(c.orderId)).toMatchObject({ licenses: 1, invoices: 1, ledger: 1, certificates: 0 });

    store.failNext = 2; // the invoice PDF stored, the certificate fails
    await fulfilOrder(db, c.orderId, store).catch(() => {});
    store.failNext = 0;
    expect((await sweepOrders(db, deps)).fulfilled).toBeGreaterThanOrEqual(1);
    expect(await orderRow(c.orderId)).toMatchObject({ status: 'fulfilled', lastError: null });
    expect(await counts(c.orderId)).toEqual(ONE_EACH);
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, c.orderId));
    expect(store.files.get(`pdfs/${inv!.pdfKey}`)!.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('invoice numbers are gap-free under concurrent fulfilment', async () => {
    const paid = [];
    for (let i = 0; i < 8; i++) {
      const c = await checkout({ billing: i % 2 ? '27' : '29' });
      await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
      paid.push(c.orderId);
    }
    await Promise.all(paid.map((id) => fulfilOrder(db, id, store)));
    const nums = (await db.select({ number: invoices.number }).from(invoices).where(sql`${invoices.orderId} in ${paid}`)).map((r) => r.number);
    expect(nums).toHaveLength(8);
    const seq = nums.map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
    expect(seq[7]! - seq[0]!).toBe(7);
    expect(new Set(nums.map((n) => n.slice(0, 10))).size).toBe(1); // one FY series
  });

  it('a track no longer sellable at fulfilment ⇒ refund_pending, nothing issued', async () => {
    const c = await checkout();
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    await db.update(tracks).set({ status: 'suspended' }).where(eq(tracks.id, c.track.trackId));
    expect(await fulfilOrder(db, c.orderId, store)).toBe('refund_pending');
    expect((await orderRow(c.orderId)).status).toBe('refund_pending');
    expect(await counts(c.orderId)).toMatchObject({ licenses: 0, invoices: 0, ledger: 0 });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, c.orderId), eq(auditLog.action, 'order.unsellable')))).toHaveLength(1);
  });

  it('a webhook that failed mid-processing is finished by the sweep', async () => {
    const c = await checkout();
    const p = gw.pay(c.gatewayOrderId);
    const w = gw.webhook('payment.captured', p);
    await recordPaymentEvent(db, { gatewayEventId: w.eventId, eventType: 'payment.captured', payload: JSON.parse(w.rawBody) }); // stored, never processed
    await sweepOrders(db, deps);
    expect((await orderRow(c.orderId)).status).toBe('fulfilled');
    const [ev] = await db.select().from(paymentEvents).where(eq(paymentEvents.gatewayEventId, w.eventId));
    expect(ev!.processedAt).toBeInstanceOf(Date);
    expect(await dbMessage(sql`UPDATE payment_events SET payload = '{}' WHERE id = ${ev!.id}`)).toMatch(/only processed_at/);
  });

  it('reconciliation pays a captured order whose webhook never came, and records it', async () => {
    const c = await checkout();
    const p = gw.pay(c.gatewayOrderId);
    const now = new Date();
    const r = await reconcilePayments(db, deps, new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000));
    expect(r.healed).toBeGreaterThanOrEqual(1);
    expect((await orderRow(c.orderId)).status).toBe('fulfilled');
    expect(await db.select().from(reconciliationItems).where(eq(reconciliationItems.gatewayRef, p.id))).toMatchObject([{ kind: 'captured_not_paid' }]);
    await reconcilePayments(db, deps, new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000)); // idempotent
    expect(await counts(c.orderId)).toEqual(ONE_EACH);
    // ops hears about it once (PLAN §10), not once per reconciliation run
    const alertsFor = async (kind: string, ref: string) => (await db.select().from(outbox).where(and(eq(outbox.kind, kind), sql`${outbox.payload}::text LIKE ${'%' + ref + '%'}`))).length;
    expect(await alertsFor('alert.captured_not_paid', p.id)).toBe(1);
  });

  it('reconciliation alerts ops once for a captured payment that matches no order and for a paid order the gateway never captured', async () => {
    const stray = gw.pay('order_never_created_here', { amountPaise: 1_000 });
    const c = await checkout();
    const paidAt = new Date(Date.now() - 5 * 60_000);
    await db.update(orders).set({ status: 'paid', gatewayPaymentId: `pay_ghost_${c.orderId}`, paidAt }).where(eq(orders.id, c.orderId));
    const now = new Date();
    for (let i = 0; i < 2; i++) await reconcilePayments(db, deps, new Date(now.getTime() - 3_600_000), new Date(now.getTime() + 60_000));
    const alertsFor = async (kind: string, ref: string) => (await db.select().from(outbox).where(and(eq(outbox.kind, kind), sql`${outbox.payload}::text LIKE ${'%' + ref + '%'}`))).length;
    expect(await alertsFor('alert.unknown_payment', stray.id)).toBe(1);
    expect(await alertsFor('alert.paid_without_capture', c.orderId)).toBe(1);
  });
});

describe('review fixes', () => {
  it('refund and dispute events are stored but left unprocessed for S3-M5, even by the sweep', async () => {
    const w = gw.webhook('refund.processed', null);
    expect(await deliver(w)).toEqual({ status: 200 });
    await sweepOrders(db, deps);
    const [ev] = await db.select().from(paymentEvents).where(eq(paymentEvents.gatewayEventId, w.eventId));
    expect(ev).toMatchObject({ eventType: 'refund.processed', processedAt: null });
  });

  it('a created order whose payment window lapsed during an outage is not opened', async () => {
    const b = await buyer();
    const track = await makeSellableTrack(db);
    const input = { trackId: track.trackId, tier: 'creator' as const, channels: [{ platform: 'youtube' as const, handleOrUrl: '@a' }], billingStateCode: '27', idempotencyKey: 'lapsed-key-1' };
    gw.failCreate = true;
    await createOrder(db, b.session, input, gw);
    gw.failCreate = false;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31 * 60_000);
    try {
      const before = gw.createCalls;
      expect(await createOrder(db, b.session, input, gw)).toEqual({ ok: false, issues: ['checkout_expired'] });
      expect(gw.createCalls).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('paid_at is when the buyer paid, so a late-noticed payment does not shift the term or the hold', async () => {
    const c = await checkout();
    const paidAt = new Date(Date.now() - 20 * 60_000);
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId, { at: paidAt })));
    await fulfilOrder(db, c.orderId, store);
    expect((await orderRow(c.orderId)).paidAt).toEqual(new Date(Math.floor(paidAt.getTime() / 1000) * 1000));
    const [lic] = await db.select().from(licenses).where(eq(licenses.orderId, c.orderId));
    expect(lic!.startsAt).toEqual((await orderRow(c.orderId)).paidAt);
  });

  it('alerts ops: rejected webhook signatures (capped), sweep failures and orders stuck in paid', async () => {
    const c = await checkout();
    const w = gw.webhook('payment.captured', gw.pay(c.gatewayOrderId, { at: new Date(Date.now() - 15 * 60_000) }));
    const sigAlerts = async () => (await db.select().from(outbox).where(eq(outbox.kind, 'alert.webhook_signature'))).length;
    const before = await sigAlerts();
    for (let i = 0; i < 5; i++) await deliver({ ...w, signature: 'bad' });
    const after = await sigAlerts();
    expect(after).toBeGreaterThanOrEqual(1); // earlier rejections in this run already raised one
    expect(after - before).toBeLessThanOrEqual(1); // five more rejections, at most one more email (hourly cap)

    await deliver(w); // paid 15 minutes ago
    store.failNext = 1_000;
    try {
      const r = await sweepOrders(db, deps);
      expect(r.stuckPaid).toBeGreaterThanOrEqual(1);
    } finally {
      store.failNext = 0;
    }
    const stuck = await db.select().from(outbox).where(eq(outbox.kind, 'alert.stuck_paid'));
    expect(stuck.some((o) => JSON.stringify(o.payload).includes(c.orderId))).toBe(true);
    expect(await db.select().from(outbox).where(eq(outbox.kind, 'alert.handler_failure'))).not.toHaveLength(0);
    await fulfilOrder(db, c.orderId, store); // leave it fulfilled for later tests
  });

  it('the daily reconcile covers the previous IST calendar day (±1h at the gateway)', async () => {
    const calls: [Date, Date][] = [];
    const spy = Object.assign(Object.create(gw), { listPayments: async (from: Date, to: Date) => (calls.push([from, to]), []) });
    await reconcilePreviousDay(db, { gateway: spy, store }, new Date('2026-11-13T00:00:00Z')); // 05:30 IST on 13 Nov
    expect(calls[0]!.map((d) => d.toISOString())).toEqual(['2026-11-11T17:30:00.000Z', '2026-11-12T19:30:00.000Z']);
  });
});

describe('issued records', () => {
  it('ledger: royalty on the taxable value, held 30 days; invoice and ledger are immutable', async () => {
    const c = await checkout();
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    await fulfilOrder(db, c.orderId, store);
    const o = await orderRow(c.orderId);
    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, c.orderId));
    expect(entry).toMatchObject({ kind: 'sale_royalty', amountPaise: Math.floor((PRICE * o.royaltyRateBps) / 10_000), sellerOrgId: c.track.sellerOrgId });
    expect(entry!.availableAt.getTime() - o.paidAt!.getTime()).toBe(30 * 86_400_000);
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, c.orderId));
    expect(inv).toMatchObject({ taxablePaise: PRICE, totalPaise: o.totalPaise, supplierGstin: '27AAPFU0939F1ZV', supplierName: 'Test Supplier Pvt Ltd', sacCode: 'TEST-SAC' });
    expect(inv!.number).toMatch(/^MRM\/\d{2}-\d{2}\/\d{6}$/);
    expect(await dbMessage(sql`UPDATE invoices SET total_paise = 1 WHERE id = ${inv!.id}`)).toMatch(/immutable/);
    expect(await dbMessage(sql`UPDATE invoices SET pdf_key = 'other' WHERE id = ${inv!.id}`)).toMatch(/write-once/);
    expect(await dbMessage(sql`DELETE FROM invoices WHERE id = ${inv!.id}`)).toMatch(/not allowed/);
    expect(await dbMessage(sql`UPDATE ledger_entries SET amount_paise = 0 WHERE id = ${entry!.id}`)).toMatch(/append-only/);
    const [lic] = await db.select().from(licenses).where(eq(licenses.orderId, c.orderId));
    expect(lic).toMatchObject({ invoiceNumber: inv!.number, startsAt: o.paidAt, licenseeName: 'Buyer Media LLP' });
    expect(await db.select().from(outbox).where(and(eq(outbox.kind, 'license.issued'), eq(outbox.to, c.b.owner.email!)))).toHaveLength(1);
  });

  it('a seller contract rate overrides the default royalty rate', async () => {
    const track = await makeSellableTrack(db);
    await db.update(sellerProfiles).set({ royaltyRateBps: 6_000 }).where(eq(sellerProfiles.orgId, track.sellerOrgId));
    const b = await buyer();
    const r = await createOrder(db, b.session, { trackId: track.trackId, tier: 'creator', channels: [{ platform: 'youtube', handleOrUrl: '@r' }], billingStateCode: '27', idempotencyKey: 'rate-key-1' }, gw);
    expect((await orderRow(r.ok ? r.value.orderId : '')).royaltyRateBps).toBe(6_000);
  });

  it('verify page: live status, masked individual licensee, agency shows client and purchaser', async () => {
    const indiv = await buyer('individual', 'Asha Verma');
    const c = await checkout({ b: indiv });
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    await fulfilOrder(db, c.orderId, store);
    const [lic] = await db.select().from(licenses).where(eq(licenses.orderId, c.orderId));
    expect(await getVerifyView(db, lic!.publicId)).toMatchObject({ status: 'active', licensee: 'A*** V****', purchaser: null, recordIntact: true, channels: [{ platform: 'youtube' }] });

    const agency = await buyer('agency', 'Agency Pvt Ltd');
    const a = await checkout({ b: agency, clientName: 'Client Brand' });
    await deliver(gw.webhook('payment.captured', gw.pay(a.gatewayOrderId)));
    await fulfilOrder(db, a.orderId, store);
    const [alic] = await db.select().from(licenses).where(eq(licenses.orderId, a.orderId));
    expect(await getVerifyView(db, alic!.publicId)).toMatchObject({ licensee: 'Client Brand', purchaser: 'Agency Pvt Ltd' });

    await revokeLicense(db, alic!.id, { reason: 'refund' });
    expect((await getVerifyView(db, alic!.publicId))!.status).toBe('revoked');
    expect(await getVerifyView(db, 'LIC-00000-00000-00000-00000-000000')).toBeNull();
    expect(await getVerifyView(db, 'not-an-id')).toBeNull();
  });

  it('clean-file downloads: buyer only, capped at 20, none after revocation', async () => {
    const c = await checkout();
    await deliver(gw.webhook('payment.captured', gw.pay(c.gatewayOrderId)));
    await fulfilOrder(db, c.orderId, store);
    const [lic] = await db.select().from(licenses).where(eq(licenses.orderId, c.orderId));
    const sign = async (bucket: string, key: string, seconds: number) => `signed:${bucket}/${key}?${seconds}`;
    const actor = { userId: c.b.owner.userId, orgId: c.b.orgId };
    const first = await issueDownloadUrl(db, actor, lic!.id, 'master', sign);
    expect(first).toMatchObject({ ok: true, value: { url: expect.stringMatching(/^signed:masters\/.+\?900$/) } });
    const stranger = await buyer();
    expect(await issueDownloadUrl(db, { userId: stranger.owner.userId, orgId: stranger.orgId }, lic!.id, 'master', sign)).toEqual({ ok: false, issues: ['not_found'] });
    for (let i = 1; i < 20; i++) await issueDownloadUrl(db, actor, lic!.id, 'master', sign);
    expect(await issueDownloadUrl(db, actor, lic!.id, 'master', sign)).toEqual({ ok: false, issues: ['download_limit_reached'] });

    const other = await checkout();
    await deliver(gw.webhook('payment.captured', gw.pay(other.gatewayOrderId)));
    await fulfilOrder(db, other.orderId, store);
    const [olic] = await db.select().from(licenses).where(eq(licenses.orderId, other.orderId));
    await revokeLicense(db, olic!.id, { reason: 'refund' });
    expect(await issueDownloadUrl(db, { userId: other.b.owner.userId, orgId: other.b.orgId }, olic!.id, 'master', sign)).toEqual({ ok: false, issues: ['license_not_active'] });
  });
});
