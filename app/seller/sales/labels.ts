import type { LedgerKind } from '@/lib/ledger/server';

export const KIND_LABELS: Record<LedgerKind, string> = {
  sale_royalty: 'Sale',
  refund_reversal: 'Refund reversal',
  chargeback_reversal: 'Chargeback reversal',
  clawback: 'Clawback',
  payout: 'Payout',
  adjustment: 'Adjustment',
};
