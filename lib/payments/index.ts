// Gateway adapter contract (PLAN §11) and payment types: safe anywhere.

export type GatewayPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';

export type GatewayPayment = {
  id: string;
  gatewayOrderId: string | null;
  amountPaise: number;
  currency: string;
  status: GatewayPaymentStatus;
  createdAt: Date;
};

export interface PaymentGateway {
  /** Public key the browser checkout needs. */
  readonly keyId: string;
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<{ gatewayOrderId: string }>;
  /** Client callback signature over `order_id|payment_id`. */
  verifyCallbackSignature(input: { gatewayOrderId: string; paymentId: string; signature: string }): boolean;
  /** Webhook signature over the raw request body. */
  verifyWebhook(rawBody: string, signature: string): boolean;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  fetchOrderPayments(gatewayOrderId: string): Promise<GatewayPayment[]>;
  listPayments(from: Date, to: Date): Promise<GatewayPayment[]>;
  /** Full refund; `receipt` is our refund row id. */
  refund(input: { paymentId: string; amountPaise: number; receipt: string }): Promise<GatewayRefund>;
  /** A refund for this receipt that Razorpay accepted and has not failed, if any: makes a retried refund call safe. */
  findRefund(paymentId: string, receipt: string): Promise<GatewayRefund | null>;
}

export type GatewayRefund = { id: string; paymentId: string; amountPaise: number; receipt: string | null; status: 'pending' | 'processed' | 'failed' };

/** Webhook events acted on (PLAN §8.1). Anything else is stored and left unprocessed. */
export const HANDLED_EVENT_TYPES = [
  'payment.captured',
  'order.paid',
  'payment.failed',
  'refund.processed',
  'refund.failed',
  'payment.dispute.created',
  'payment.dispute.won',
  'payment.dispute.lost',
] as const;
