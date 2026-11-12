// Order state machine (PLAN §4.3), checkout input and snapshot types: safe anywhere.
import { z } from 'zod';
import { isGstStateCode, isValidGstin } from '@/lib/invoicing';
import { TIERS, channelInputSchema } from '@/lib/licensing';

export const ORDER_STATUSES = [
  'created',
  'awaiting_payment',
  'paid',
  'failed',
  'expired',
  'fulfilled',
  'refund_pending',
  'refunded',
  'charged_back_pending',
  'charged_back',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_EVENTS = [
  'open_payment',
  'capture',
  'fail',
  'expire',
  'fulfil',
  'unsellable',
  'refund',
  'refund_processed',
  'chargeback',
  'chargeback_won',
  'chargeback_lost',
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

/**
 * PLAN §4.3, plus failed → paid: Razorpay lets the buyer retry inside the same checkout, so a capture can
 * follow a failed attempt, and money taken is always treated as paid (as for expired → paid).
 * The DB trigger on orders enforces the same pairs.
 */
export const ORDER_TRANSITIONS: readonly { from: OrderStatus; event: OrderEvent; to: OrderStatus }[] = [
  { from: 'created', event: 'open_payment', to: 'awaiting_payment' },
  { from: 'awaiting_payment', event: 'capture', to: 'paid' },
  { from: 'awaiting_payment', event: 'fail', to: 'failed' },
  { from: 'awaiting_payment', event: 'expire', to: 'expired' },
  { from: 'failed', event: 'capture', to: 'paid' },
  { from: 'expired', event: 'capture', to: 'paid' },
  { from: 'paid', event: 'fulfil', to: 'fulfilled' },
  { from: 'paid', event: 'unsellable', to: 'refund_pending' },
  { from: 'fulfilled', event: 'refund', to: 'refund_pending' },
  { from: 'refund_pending', event: 'refund_processed', to: 'refunded' },
  { from: 'fulfilled', event: 'chargeback', to: 'charged_back_pending' },
  { from: 'charged_back_pending', event: 'chargeback_won', to: 'fulfilled' },
  { from: 'charged_back_pending', event: 'chargeback_lost', to: 'charged_back' },
];

export function nextOrderStatus(from: OrderStatus, event: OrderEvent): OrderStatus | null {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
}

/** Unpaid orders expire after this (PLAN §5.2 step 2). */
export const ORDER_TTL_MINUTES = 30;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const checkoutInputSchema = z.object({
  trackId: z.uuid(),
  tier: z.enum(TIERS),
  licenseeName: optionalText(300),
  clientName: optionalText(300),
  channels: z.array(channelInputSchema).min(1).max(10),
  billingStateCode: z.string().refine(isGstStateCode, 'choose a billing state'),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || isValidGstin(v), 'invalid GSTIN'),
  idempotencyKey: z.string().min(8).max(100),
});
export type CheckoutInput = z.input<typeof checkoutInputSchema>;

/** Descriptive facts frozen on the order; money lives in typed columns. */
export type OrderSnapshot = {
  trackTitle: string;
  primaryArtist: string;
  editsAllowed: boolean;
  licenseeName: string;
  clientName: string | null;
  channels: { platform: 'youtube' | 'instagram' | 'facebook'; handleOrUrl: string }[];
  buyerEmail: string | null;
  recipientName: string;
  recipientGstin: string | null;
  recipientStateCode: string;
  recipientAddress: string | null;
  placeOfSupplyState: string;
  supplierName: string;
  supplierAddress: string;
  supplierGstin: string;
  supplierStateCode: string;
  sacCode: string;
  licenseTextVersion: number;
};

export type CheckoutParams = {
  orderId: string;
  status: OrderStatus;
  gatewayOrderId: string | null;
  keyId: string;
  amountPaise: number;
  currency: 'INR';
};
