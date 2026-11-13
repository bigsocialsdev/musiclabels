import { and, eq } from 'drizzle-orm';
import { orderEvents, orders } from '@/db/schema';
import { getMembershipRole, getOrganization } from '@/lib/identity/server';
import { computeGst, getBillingConfig, placeOfSupply } from '@/lib/invoicing/server';
import { checkAcceptance, recordAcceptance } from '@/lib/legal/server';
import { getTermsVersion, quoteLicense, type Result } from '@/lib/licensing/server';
import type { PaymentGateway } from '@/lib/payments';
import type { DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { log, errorMessage } from '@/lib/platform/log';
import { consume } from '@/lib/platform/ratelimit';
import { getSellerStanding } from '@/lib/sellers/server';
import { ORDER_TTL_MINUTES, checkoutInputSchema, type CheckoutInput, type CheckoutParams, type OrderSnapshot, type OrderStatus } from '../index';
import { applyOrderTransition } from './transition';

export type BuyerSession = { userId: string; orgId: string; email: string | null; ip?: string | null; userAgent?: string | null };

const CHECKOUT_LIMIT = { capacity: 20, refillPerSecond: 20 / 3600 };

type Order = typeof orders.$inferSelect;

/**
 * Creates (or, for a repeated idempotency key, resumes) a single-track order (PLAN §5.2 step 2). Every price,
 * tax and term is computed server-side and snapshotted; the client supplies only choices. Errors that the
 * buyer can fix come back as issues; the Razorpay order is opened last, so a gateway outage leaves a
 * `created` order the same key can resume.
 */
export async function createOrder(db: DbOrTx, buyer: BuyerSession, raw: CheckoutInput, gateway: PaymentGateway): Promise<Result<CheckoutParams>> {
  const parsed = checkoutInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
  const input = parsed.data;

  if (!(await getMembershipRole(db, buyer.userId, buyer.orgId))) return { ok: false, issues: ['not_found'] };
  const org = await getOrganization(db, buyer.orgId);
  if (org?.kind !== 'buyer') return { ok: false, issues: ['not_a_buyer_org'] };

  const [existing] = await db.select().from(orders).where(and(eq(orders.buyerUserId, buyer.userId), eq(orders.idempotencyKey, input.idempotencyKey)));
  if (existing) return openPayment(db, existing, gateway);

  const gate = await checkAcceptance(db, buyer.userId, ['tos', 'privacy']);
  if (!gate.ok) return { ok: false, issues: ['terms_not_accepted'] };
  if (!(await consume(`checkout:${buyer.userId}`, CHECKOUT_LIMIT, db))) return { ok: false, issues: ['rate_limited'] };

  const quote = await quoteLicense(db, input.trackId, input.tier);
  if (!quote.ok) return quote;
  const q = quote.value;
  const terms = (await getTermsVersion(db, q.termsVersionId))!;

  const issues: string[] = [];
  if (input.channels.length > terms.maxChannels) issues.push('too_many_channels');
  if (input.channels.some((c) => !(terms.allowedPlatforms as string[]).includes(c.platform))) issues.push('platform_not_allowed');
  const keys = input.channels.map((c) => `${c.platform}/${c.handleOrUrl.toLowerCase()}`);
  if (new Set(keys).size !== keys.length) issues.push('duplicate_channel');
  if (input.clientName && org.buyerType !== 'agency') issues.push('client_name_agency_only');
  if (issues.length) return { ok: false, issues };

  const billing = getBillingConfig();
  const pos = placeOfSupply(input.gstin ?? null, input.billingStateCode);
  const gst = computeGst({ taxablePaise: q.amountPaise, gstRateBps: billing.gstRateBps, supplierStateCode: billing.supplierStateCode, placeOfSupplyState: pos });
  const standing = await getSellerStanding(db, q.sellerOrgId);
  const royaltyRateBps = standing?.royaltyRateBps ?? getEnv().DEFAULT_ROYALTY_RATE_BPS;
  if (royaltyRateBps === undefined || royaltyRateBps === null) throw new Error('DEFAULT_ROYALTY_RATE_BPS is not configured');

  const clientName = input.clientName ?? null;
  const snapshot: OrderSnapshot = {
    trackTitle: q.trackTitle,
    primaryArtist: q.primaryArtist,
    editsAllowed: q.editsAllowed,
    licenseeName: clientName ?? input.licenseeName ?? org.legalName, // PLAN §6.3
    clientName,
    channels: input.channels,
    buyerEmail: buyer.email,
    recipientName: org.legalName,
    recipientGstin: input.gstin ?? null,
    recipientStateCode: pos,
    recipientAddress: org.billingAddress,
    placeOfSupplyState: pos,
    supplierName: billing.supplierName,
    supplierAddress: billing.supplierAddress,
    supplierGstin: billing.supplierGstin,
    supplierStateCode: billing.supplierStateCode,
    sacCode: billing.sacCode,
    licenseTextVersion: q.licenseTextVersion,
  };

  const order = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(orders)
      .values({
        buyerOrgId: buyer.orgId,
        buyerUserId: buyer.userId,
        idempotencyKey: input.idempotencyKey,
        trackId: q.trackId,
        trackVersionId: q.trackVersionId,
        sellerOrgId: q.sellerOrgId,
        tier: q.tier,
        termsVersionId: q.termsVersionId,
        licenseTextDocumentId: q.licenseTextDocumentId,
        priceBookId: q.priceBookId,
        priceLevel: q.priceLevel,
        taxablePaise: gst.taxablePaise,
        cgstPaise: gst.cgstPaise,
        sgstPaise: gst.sgstPaise,
        igstPaise: gst.igstPaise,
        totalPaise: gst.totalPaise,
        gstRateBps: gst.gstRateBps,
        royaltyRateBps,
        snapshot,
        expiresAt: new Date(Date.now() + ORDER_TTL_MINUTES * 60_000),
      })
      .onConflictDoNothing({ target: [orders.buyerUserId, orders.idempotencyKey] })
      .returning();
    if (!row) return null; // a concurrent request with the same key won
    await tx.insert(orderEvents).values({ orderId: row.id, fromStatus: 'none', toStatus: 'created', event: 'create', actorUserId: buyer.userId });
    // Buying is accepting the tier's license text (PLAN §6.2); acceptances are append-only.
    await recordAcceptance(tx, { userId: buyer.userId, orgId: buyer.orgId, documentId: q.licenseTextDocumentId, ip: buyer.ip, userAgent: buyer.userAgent });
    return row;
  });
  const current =
    order ?? (await db.select().from(orders).where(and(eq(orders.buyerUserId, buyer.userId), eq(orders.idempotencyKey, input.idempotencyKey))))[0]!;
  return openPayment(db, current, gateway);
}

/** Opens the Razorpay order once (created → awaiting_payment); later calls return the same checkout params. */
async function openPayment(db: DbOrTx, order: Order, gateway: PaymentGateway): Promise<Result<CheckoutParams>> {
  const params = (o: Order): CheckoutParams => ({
    orderId: o.id,
    status: o.status as OrderStatus,
    gatewayOrderId: o.gatewayOrderId,
    keyId: gateway.keyId,
    amountPaise: o.totalPaise,
    currency: 'INR',
  });
  if (order.status !== 'created') return { ok: true, value: params(order) };
  // The payment window runs from order creation; a lapsed one is never opened. A new checkout gets a new key.
  if (order.expiresAt <= new Date()) return { ok: false, issues: ['checkout_expired'] };
  let gatewayOrderId: string;
  try {
    ({ gatewayOrderId } = await gateway.createOrder({ amountPaise: order.totalPaise, receipt: order.id, notes: { order_id: order.id } }));
  } catch (e) {
    log.error('gateway order creation failed', { orderId: order.id, error: errorMessage(e) });
    return { ok: false, issues: ['payment_gateway_unavailable'] };
  }
  await applyOrderTransition(db, order.id, 'open_payment', { actorUserId: order.buyerUserId, set: { gatewayOrderId } });
  const [now] = await db.select().from(orders).where(eq(orders.id, order.id));
  return { ok: true, value: params(now!) };
}
