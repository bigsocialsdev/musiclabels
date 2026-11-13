import { listSellerLedger } from '@/lib/ledger/server';
import { csvCell } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { requireSellerSession } from '../../session';
import { rupees } from '../../format';
import { KIND_LABELS, STATUS_LABELS } from '../labels';

export const dynamic = 'force-dynamic';

const day = (d: Date) => d.toISOString().slice(0, 10);
const BOM = String.fromCharCode(0xfeff);

/** The org's ledger as a CSV attachment: the same rows as the sales page, up to 5000. */
export async function GET() {
  const { session, orgId } = await requireSellerSession('/seller/sales');
  if (!orgId) return new Response('Create your seller account first.', { status: 404 });
  const rows = await listSellerLedger(getDb(), { userId: session.userId, orgId }, { limit: 5000 });
  const now = new Date();
  const header = ['date', 'type', 'track', 'tier', 'sale_value_inr', 'royalty_inr', 'available_from', 'status'];
  // Text goes through csvCell (formula prefixes neutralised); amounts and dates are ours and stay plain numbers.
  const lines = rows.map((r) =>
    [
      day(r.at),
      csvCell(KIND_LABELS[r.kind]),
      csvCell(r.trackTitle ?? ''),
      csvCell(r.tier ?? ''),
      r.taxablePaise === null ? '' : rupees(r.taxablePaise),
      rupees(r.amountPaise),
      day(r.availableAt),
      csvCell(STATUS_LABELS[r.status].toLowerCase()),
    ].join(','),
  );
  const body = BOM + [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n'; // BOM so Excel reads UTF-8 titles
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="sales-${day(now)}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
}
