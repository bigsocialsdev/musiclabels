import { ledgerEntries } from '@/db/schema';
import type { Tx } from '@/lib/platform/db';
import { ROYALTY_HOLD_DAYS, royaltyPaise } from '../index';

/**
 * Credits the seller's royalty for a paid order, available after the hold. Runs inside fulfilment's
 * legal-facts transaction; unique (order_id, kind) makes a re-run a no-op.
 */
export async function creditSaleRoyalty(
  tx: Tx,
  input: { orderId: string; sellerOrgId: string; taxablePaise: number; royaltyRateBps: number; paidAt: Date },
): Promise<void> {
  await tx
    .insert(ledgerEntries)
    .values({
      sellerOrgId: input.sellerOrgId,
      kind: 'sale_royalty',
      amountPaise: royaltyPaise(input.taxablePaise, input.royaltyRateBps),
      orderId: input.orderId,
      availableAt: new Date(input.paidAt.getTime() + ROYALTY_HOLD_DAYS * 86_400_000),
    })
    .onConflictDoNothing();
}
