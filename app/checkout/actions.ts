'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createOrganization, safeNext } from '@/lib/identity/server';
import { createOrder, fulfilOrder, productionDeps, verifyCheckoutCallback, type CallbackResult, type CheckoutParams } from '@/lib/orders/server';
import type { Result } from '@/lib/licensing';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { kick } from '@/lib/platform/tasks';
import { requireBuyerSession } from '../buyer-session';

const orgInput = z.object({
  legalName: z.string().trim().min(2).max(200),
  buyerType: z.enum(['individual', 'business', 'agency']),
});

/** First purchase: the buyer creates the org they buy for (an individual is a one-member org). */
export async function createBuyerOrgAction(rawReturnTo: string, formData: FormData) {
  const returnTo = safeNext(rawReturnTo); // bound args come back from the client
  const session = await requireBuyerSession(returnTo);
  const input = orgInput.safeParse(Object.fromEntries(formData));
  if (!input.success) redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent('Enter a name and buyer type')}`);
  await createOrganization(getDb(), session.userId, { kind: 'buyer', legalName: input.data.legalName, displayName: input.data.legalName, buyerType: input.data.buyerType });
  redirect(returnTo);
}

/** Creates or resumes the order; every amount is computed server-side from the track, tier and billing details. */
export async function startCheckoutAction(raw: unknown): Promise<Result<CheckoutParams>> {
  const session = await requireBuyerSession('/');
  const { orgId, ...input } = z.object({ orgId: z.uuid() }).passthrough().parse(raw);
  const h = await headers();
  return createOrder(
    getDb(),
    { userId: session.userId, orgId, email: session.email, ip: clientIp(h), userAgent: h.get('user-agent') },
    input as Parameters<typeof createOrder>[2],
    productionDeps().gateway,
  );
}

const callbackInput = z.object({ orgId: z.uuid(), orderId: z.uuid(), paymentId: z.string().min(1).max(100), gatewayOrderId: z.string().min(1).max(100), signature: z.string().min(1).max(200) });

/** Razorpay Checkout's success handler posts here; the payment is re-fetched from Razorpay before anything changes. */
export async function confirmPaymentAction(raw: unknown): Promise<CallbackResult> {
  const session = await requireBuyerSession('/');
  const { orgId, ...input } = callbackInput.parse(raw);
  const deps = productionDeps();
  const result = await verifyCheckoutCallback(getDb(), { userId: session.userId, orgId, email: session.email }, input, deps.gateway);
  if (result.ok && result.fulfil) kick('fulfil', () => fulfilOrder(getDb(), result.orderId, deps.store));
  return result;
}
