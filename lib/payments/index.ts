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
}

/** Webhook events this milestone acts on; refund and dispute events are added with S3-M5. */
export const HANDLED_EVENT_TYPES = ['payment.captured', 'order.paid', 'payment.failed'] as const;
