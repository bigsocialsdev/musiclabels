import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { safeEqual } from '@/lib/platform/crypto';
import { getEnv } from '@/lib/platform/env';
import type { GatewayPayment, PaymentGateway } from '../index';

const API = 'https://api.razorpay.com/v1';

const paymentSchema = z.object({
  id: z.string(),
  order_id: z.string().nullable().optional(),
  amount: z.number().int(),
  currency: z.string(),
  status: z.enum(['created', 'authorized', 'captured', 'refunded', 'failed']),
  created_at: z.number(),
});

/** Maps a Razorpay payment entity (API response or webhook payload). */
export function toGatewayPayment(raw: unknown): GatewayPayment {
  const p = paymentSchema.parse(raw);
  return { id: p.id, gatewayOrderId: p.order_id ?? null, amountPaise: p.amount, currency: p.currency, status: p.status, createdAt: new Date(p.created_at * 1000) };
}

const hmacHex = (secret: string, data: string) => createHmac('sha256', secret).update(data, 'utf8').digest('hex');

/** Razorpay Orders + Payments REST API with Basic auth. Auto-capture is configured on the account. */
export class RazorpayGateway implements PaymentGateway {
  readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(cfg?: { keyId: string; keySecret: string; webhookSecret: string }) {
    const env = getEnv();
    const c = cfg ?? { keyId: env.RAZORPAY_KEY_ID ?? '', keySecret: env.RAZORPAY_KEY_SECRET ?? '', webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '' };
    if (!c.keyId || !c.keySecret || !c.webhookSecret) throw new Error('Razorpay is not configured');
    this.keyId = c.keyId;
    this.keySecret = c.keySecret;
    this.webhookSecret = c.webhookSecret;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Razorpay ${method} ${path.split('?')[0]} failed (${res.status})`);
    return res.json();
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    const r = z
      .object({ id: z.string() })
      .parse(await this.call('POST', '/orders', { amount: input.amountPaise, currency: 'INR', receipt: input.receipt, notes: input.notes }));
    return { gatewayOrderId: r.id };
  }

  verifyCallbackSignature(input: { gatewayOrderId: string; paymentId: string; signature: string }) {
    return safeEqual(hmacHex(this.keySecret, `${input.gatewayOrderId}|${input.paymentId}`), input.signature);
  }

  verifyWebhook(rawBody: string, signature: string) {
    return safeEqual(hmacHex(this.webhookSecret, rawBody), signature);
  }

  async fetchPayment(paymentId: string) {
    return toGatewayPayment(await this.call('GET', `/payments/${encodeURIComponent(paymentId)}`));
  }

  async fetchOrderPayments(gatewayOrderId: string) {
    const r = z.object({ items: z.array(z.unknown()) }).parse(await this.call('GET', `/orders/${encodeURIComponent(gatewayOrderId)}/payments`));
    return r.items.map(toGatewayPayment);
  }

  async listPayments(from: Date, to: Date) {
    const out: GatewayPayment[] = [];
    for (let skip = 0; ; skip += 100) {
      const q = new URLSearchParams({ from: String(Math.floor(from.getTime() / 1000)), to: String(Math.floor(to.getTime() / 1000)), count: '100', skip: String(skip) });
      const r = z.object({ items: z.array(z.unknown()) }).parse(await this.call('GET', `/payments?${q}`));
      out.push(...r.items.map(toGatewayPayment));
      if (r.items.length < 100) return out;
    }
  }
}

let cached: PaymentGateway | undefined;
export function getPaymentGateway(): PaymentGateway {
  return (cached ??= new RazorpayGateway());
}
