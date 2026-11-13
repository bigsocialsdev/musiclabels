import { createHmac, randomBytes } from 'node:crypto';
import type { GatewayPayment, GatewayRefund } from '@/lib/payments';
import { RazorpayGateway } from '@/lib/payments/server';
import type { ObjectStore } from '@/lib/platform/storage';

const rid = (prefix: string) => `${prefix}_${randomBytes(7).toString('hex')}`;

/**
 * Razorpay with the network replaced by memory. Signature checks are the real RazorpayGateway code, keyed by
 * the test secrets in tests/setup.ts, so tests sign requests the way Razorpay does.
 */
export class FakeGateway extends RazorpayGateway {
  orders = new Map<string, { amountPaise: number; receipt: string }>();
  payments = new Map<string, GatewayPayment>();
  createCalls = 0;
  failCreate = false;

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    this.createCalls++;
    if (this.failCreate) throw new Error('gateway down');
    const id = rid('order');
    this.orders.set(id, { amountPaise: input.amountPaise, receipt: input.receipt });
    return { gatewayOrderId: id };
  }
  async fetchPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error('no such payment');
    return p;
  }
  async fetchOrderPayments(gatewayOrderId: string) {
    return [...this.payments.values()].filter((p) => p.gatewayOrderId === gatewayOrderId);
  }
  async listPayments(from: Date, to: Date) {
    return [...this.payments.values()].filter((p) => p.createdAt >= from && p.createdAt < to);
  }

  /** The buyer pays: a captured (or other status) payment on a gateway order. */
  pay(gatewayOrderId: string, opts: { amountPaise?: number; status?: GatewayPayment['status']; at?: Date } = {}): GatewayPayment {
    const p: GatewayPayment = {
      id: rid('pay'),
      gatewayOrderId,
      amountPaise: opts.amountPaise ?? this.orders.get(gatewayOrderId)!.amountPaise,
      currency: 'INR',
      status: opts.status ?? 'captured',
      createdAt: new Date(Math.floor((opts.at ?? new Date()).getTime() / 1000) * 1000), // Razorpay timestamps are whole seconds
    };
    this.payments.set(p.id, p);
    return p;
  }

  refunds = new Map<string, GatewayRefund>();
  refundCalls = 0;
  refundOutcome: GatewayRefund['status'] = 'processed';
  /** The next refund is accepted by "Razorpay" but the call then fails, as if our process died mid-request. */
  dieAfterNextRefund = false;

  async refund(input: { paymentId: string; amountPaise: number; receipt: string }) {
    this.refundCalls++;
    const r: GatewayRefund = { id: rid('rfnd'), paymentId: input.paymentId, amountPaise: input.amountPaise, receipt: input.receipt, status: this.refundOutcome };
    this.refunds.set(r.id, r);
    if (this.dieAfterNextRefund) {
      this.dieAfterNextRefund = false;
      throw new Error('connection reset after the refund was accepted');
    }
    return r;
  }
  async findRefund(paymentId: string, receipt: string) {
    return [...this.refunds.values()].find((r) => r.paymentId === paymentId && r.receipt === receipt) ?? null;
  }

  /** Any signed event with a raw payload (refund, dispute, …). */
  event(event: string, payload: Record<string, unknown>, eventId = rid('evt')) {
    const rawBody = JSON.stringify({ entity: 'event', event, payload });
    return { rawBody, signature: createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex'), eventId };
  }
  refundEvent(event: 'refund.processed' | 'refund.failed', r: GatewayRefund) {
    return this.event(event, { refund: { entity: { id: r.id, payment_id: r.paymentId, amount: r.amountPaise, receipt: r.receipt, status: event === 'refund.processed' ? 'processed' : 'failed' } } });
  }
  disputeEvent(outcome: 'created' | 'won' | 'lost', d: { id: string; paymentId: string; amountPaise: number }) {
    return this.event(`payment.dispute.${outcome}`, { dispute: { entity: { id: d.id, payment_id: d.paymentId, amount: d.amountPaise } } });
  }

  callbackSignature(gatewayOrderId: string, paymentId: string) {
    return createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(`${gatewayOrderId}|${paymentId}`).digest('hex');
  }

  /** A webhook delivery as Razorpay sends it: raw JSON body, HMAC signature, event id header. */
  webhook(event: string, p: GatewayPayment | null, eventId = rid('evt')) {
    if (!p) {
      const rawBody = JSON.stringify({ entity: 'event', event, payload: { refund: { entity: { id: rid('rfnd') } } } });
      return { rawBody, signature: createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex'), eventId };
    }
    const rawBody = JSON.stringify({
      entity: 'event',
      event,
      payload: {
        payment: {
          entity: { id: p.id, order_id: p.gatewayOrderId, amount: p.amountPaise, currency: p.currency, status: p.status, created_at: Math.floor(p.createdAt.getTime() / 1000) },
        },
      },
    });
    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
    return { rawBody, signature, eventId };
  }
}

/** In-memory Storage; `failNext` makes the next N uploads throw (simulated crash between fulfilment steps). */
export class MemoryStore implements ObjectStore {
  files = new Map<string, Buffer>();
  failNext = 0;
  async downloadToFile(): Promise<void> {
    throw new Error('not used');
  }
  async upload(bucket: string, path: string, data: Buffer) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('storage unavailable');
    }
    this.files.set(`${bucket}/${path}`, data);
  }
}
