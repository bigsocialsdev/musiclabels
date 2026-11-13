import { BUCKETS, type ObjectStore } from '@/lib/platform/storage';
import type { PayoutRail, RailLine } from '../index';

/** CSV cell, quoted, with spreadsheet formula prefixes neutralised (the file is opened in Excel by finance). */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function bankFileCsv(lines: RailLine[]): string {
  const header = ['payout_reference', 'beneficiary_name', 'account_number', 'ifsc', 'amount_inr'];
  const rows = lines.map((l) => [l.reference, l.accountHolderName, l.accountNumber, l.ifsc, (l.netPaise / 100).toFixed(2)].map(csvCell).join(','));
  return [header.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n';
}

/**
 * F7: a bank bulk-upload file in the private documents bucket. Finance uploads it to the bank and records each
 * UTR. The key is per batch, so a re-submission rewrites the same file. Generic column layout; the bank's own
 * template is an ops detail to confirm.
 */
export class BankFileRail implements PayoutRail {
  readonly id = 'bank_file' as const;
  constructor(private readonly store: ObjectStore) {}

  async submit(batch: { batchId: string; period: string; lines: RailLine[] }) {
    const key = `payouts/${batch.period}/${batch.batchId}.csv`;
    await this.store.upload(BUCKETS.documents, key, Buffer.from(bankFileCsv(batch.lines), 'utf8'), 'text/csv');
    return { railRef: key };
  }
}
