/** Locked decision: every sale royalty is held 30 days before it can be paid out (refund window funding). */
export const ROYALTY_HOLD_DAYS = 30;

/** Royalty = taxable value × contract rate, rounded down (CLAUDE.md). GST is never in the base. */
export function royaltyPaise(taxablePaise: number, royaltyRateBps: number): number {
  if (!Number.isSafeInteger(taxablePaise) || taxablePaise < 0) throw new Error('taxable value must be a non-negative integer');
  if (!Number.isInteger(royaltyRateBps) || royaltyRateBps < 0 || royaltyRateBps > 10_000) throw new Error('invalid royalty rate');
  return Number((BigInt(taxablePaise) * BigInt(royaltyRateBps)) / 10_000n);
}
