import type { LedgerKind } from '@/lib/ledger';
import type { SellerLedgerRow } from '@/lib/ledger/server';

export const KIND_LABELS: Record<LedgerKind, string> = {
  sale_royalty: 'Sale',
  refund_reversal: 'Refund reversal',
  chargeback_reversal: 'Chargeback reversal',
  clawback: 'Clawback',
  payout: 'Payout',
  adjustment: 'Adjustment',
};

export const STATUS_LABELS: Record<SellerLedgerRow['status'], string> = {
  paid_out: 'Paid out',
  on_hold: 'On hold',
  matured: 'Matured',
};
