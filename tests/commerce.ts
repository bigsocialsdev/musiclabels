import { eq } from 'drizzle-orm';
import { licenses } from '@/db/schema';
import type { PriceLevel } from '@/lib/catalog';
import { acceptPending, publishLegalDocument } from '@/lib/legal/server';
import { TIERS, publishTermsVersion, type Tier } from '@/lib/licensing/server';
import { createOrder, fulfilOrder, handleRazorpayWebhook, type BuyerSession } from '@/lib/orders/server';
import type { Db } from '@/lib/platform/db';
import { activatePriceBook, createPriceBook } from '@/lib/pricing/server';
import { makeBuyer, makeSellableTrack, makeUser } from './factories';
import type { FakeGateway, MemoryStore } from './fakes';

export const adminCtx = async (db: Db, permissions: ('superadmin' | 'verification' | 'finance' | 'disputes')[]) => ({
  userId: (await makeUser(db, { admin: permissions, aal: 'aal2' })).userId,
  permissions,
});

/** ToS/privacy, terms per tier and an active price book where each level has one price for every tier. */
export async function setupCommerce(db: Db, prices: Record<PriceLevel, number>) {
  const sa = await adminCtx(db, ['superadmin']);
  for (const kind of ['tos', 'privacy'] as const) await publishLegalDocument(db, sa, { kind, bodyMarkdown: `${kind} text` });
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
  const a = await adminCtx(db, ['verification']);
  const book = await createPriceBook(
    db,
    a,
    (Object.keys(prices) as PriceLevel[]).flatMap((priceLevel) => TIERS.map((tier) => ({ priceLevel, tier, amountPaise: prices[priceLevel] }))),
  );
  await activatePriceBook(db, a, book.id);
}

export async function readyBuyer(db: Db, type: 'individual' | 'business' | 'agency' = 'business') {
  const b = await makeBuyer(db, 'Buyer Media LLP', type);
  await acceptPending(db, { userId: b.owner.userId, kinds: ['tos', 'privacy'] });
  const session: BuyerSession = { userId: b.owner.userId, orgId: b.orgId, email: b.owner.email };
  return { ...b, session };
}

/** One complete sale: checkout, a signed payment.captured webhook (paid at `paidAt`), fulfilment. */
export async function sale(
  db: Db,
  gw: FakeGateway,
  store: MemoryStore,
  opts: { sellerOrgId?: string; priceLevel?: PriceLevel; paidAt?: Date; tier?: Tier; fulfil?: boolean } = {},
) {
  const track = await makeSellableTrack(db, { sellerOrgId: opts.sellerOrgId, priceLevel: opts.priceLevel ?? 'L1' });
  const buyer = await readyBuyer(db);
  const r = await createOrder(
    db,
    buyer.session,
    { trackId: track.trackId, tier: opts.tier ?? 'creator', channels: [{ platform: 'youtube', handleOrUrl: '@b' }], billingStateCode: '27', idempotencyKey: `k-${Math.random()}` },
    gw,
  );
  if (!r.ok) throw new Error(r.issues.join());
  const payment = gw.pay(r.value.gatewayOrderId!, { at: opts.paidAt });
  const w = gw.webhook('payment.captured', payment);
  await handleRazorpayWebhook(db, { rawBody: w.rawBody, signature: w.signature, eventId: w.eventId }, gw);
  if (opts.fulfil !== false) await fulfilOrder(db, r.value.orderId, store);
  const [lic] = await db.select({ id: licenses.id }).from(licenses).where(eq(licenses.orderId, r.value.orderId));
  return { orderId: r.value.orderId, sellerOrgId: track.sellerOrgId, trackId: track.trackId, buyer, payment, licenseId: lic?.id ?? null };
}

export const deliver = (db: Db, gw: FakeGateway, w: { rawBody: string; signature: string; eventId: string }) =>
  handleRazorpayWebhook(db, { rawBody: w.rawBody, signature: w.signature, eventId: w.eventId }, gw);
