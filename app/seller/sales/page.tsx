import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { formatInr } from '@/lib/invoicing';
import { getSellerBalances, listSellerLedger } from '@/lib/ledger/server';
import { getDb } from '@/lib/platform/db';
import { fmtDate } from '../format';
import { requireSellerSession } from '../session';
import { Table, Td, Th } from '../table';
import { Page, PageHeader } from '../ui';
import { KIND_LABELS, STATUS_LABELS } from './labels';

export const dynamic = 'force-dynamic';

export default async function SellerSalesPage() {
  const { session, orgId } = await requireSellerSession('/seller/sales');
  if (!orgId) redirect('/seller/onboarding');
  const db = getDb();
  const actor = { userId: session.userId, orgId };
  const [rows, balances] = await Promise.all([listSellerLedger(db, actor, { limit: 200 }), getSellerBalances(db, actor)]);
  const balanceLines = [
    ['Past the hold, not yet in a payout', balances.availablePaise],
    ['In a payout being paid', balances.inPayoutPaise],
    ['On hold (30 days after each sale)', balances.heldPaise],
  ] as const;
  return (
    <Page width="wide">
      <PageHeader
        title="Sales and royalties"
        aside={
          <Link href="/seller/sales/export" className={buttonVariants({ variant: 'outline' })}>
            Download CSV
          </Link>
        }
      />
      <dl className="max-w-xl rounded-lg border bg-card px-5 py-2">
        {balanceLines.map(([label, paise]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
            <dt className="text-sm text-fg-2">{label}</dt>
            <dd className="font-mono text-[15px] font-medium">{formatInr(paise)}</dd>
          </div>
        ))}
      </dl>
      <p className="max-w-[70ch] text-sm text-muted-foreground">
        Royalties are paid once a month to your verified bank account, after the 30-day hold, once your KYC is verified and the total reaches the minimum. They cannot be withdrawn earlier. Amounts exclude GST. See{' '}
        <Link href="/seller/payouts" className="font-semibold text-foreground underline underline-offset-4">
          payouts
        </Link>{' '}
        for what has been paid.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sales yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>What</Th>
              <Th>Track</Th>
              <Th num>Sale value</Th>
              <Th num>Royalty</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-background">
                <Td mono className="whitespace-nowrap">
                  {fmtDate(r.at)}
                </Td>
                <Td>{KIND_LABELS[r.kind]}</Td>
                <Td>{r.trackTitle ? `${r.trackTitle}${r.tier ? ` (${r.tier})` : ''}` : '—'}</Td>
                <Td num>{r.taxablePaise === null ? '—' : formatInr(r.taxablePaise)}</Td>
                <Td num className="font-medium">
                  {formatInr(r.amountPaise)}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">
                  {STATUS_LABELS[r.status]}
                  {r.status === 'on_hold' && ` until ${fmtDate(r.availableAt)}`}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {rows.length === 200 && <p className="text-xs text-muted-foreground">Showing the latest 200 entries. The CSV has more.</p>}
    </Page>
  );
}
