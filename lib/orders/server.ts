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
export { fulfilOrder, type FulfilResult } from './internal/fulfil';
export { sweepOrders, reconcilePayments, reconcilePreviousDay, type OrderDeps } from './internal/sweep';
export { getOrderForBuyer } from './internal/read';

/** Production adapters; tests pass fakes instead. */
export const productionDeps = (): OrderDeps => ({ gateway: getPaymentGateway(), store: supabaseObjectStore });
