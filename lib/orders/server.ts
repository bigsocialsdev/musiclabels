import 'server-only';
import { getPaymentGateway } from '@/lib/payments/server';
import { supabaseObjectStore } from '@/lib/platform/storage';
import type { OrderDeps } from './internal/sweep';

export * from './index';
export { createOrder, type BuyerSession } from './internal/create';
export { applyOrderTransition, type OrderTransitionResult } from './internal/transition';
export {
  markPaid,
  processPaymentEvent,
  handleRazorpayWebhook,
  verifyCheckoutCallback,
  expireIfUnpaid,
  type MarkPaidResult,
  type CallbackResult,
  type WebhookOutcome,
} from './internal/payment';
export { previewReceipt, type ReceiptTier } from './internal/receipt';
export { fulfilOrder, type FulfilResult } from './internal/fulfil';
export { requestRefund, executeRefund, completeRefund, failRefund, type RequestRefundResult, type RefundRun } from './internal/refund';
export { applyDisputeEvent } from './internal/chargeback';
export { sweepOrders, reconcilePayments, reconcilePreviousDay, type OrderDeps } from './internal/sweep';
export { getOrderForBuyer } from './internal/read';

/** Production adapters; tests pass fakes instead. */
export const productionDeps = (): OrderDeps => ({ gateway: getPaymentGateway(), store: supabaseObjectStore });
