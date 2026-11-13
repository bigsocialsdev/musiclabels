import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { formatInr } from '@/lib/invoicing';
import { listSellerPayouts, type SellerPayoutRow } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { fmtDate } from '../format';
import { requireSellerSession } from '../session';
import { Table, Td, Th } from '../table';
import { Page, PageHeader } from '../ui';

export const dynamic = 'force-dynamic';

const STATUS: Record<SellerPayoutRow['status'], { label: string; tone: StatusTone }> = {
  pending: { label: 'Being prepared', tone: 'info' },
  processing: { label: 'Sent to the bank', tone: 'info' },
  paid: { label: 'Paid', tone: 'ok' },
  failed: { label: 'Failed, carried to the next run', tone: 'blocked' },
};

export default async function SellerPayoutsPage() {
  const { session, orgId } = await requireSellerSession('/seller/payouts');
  if (!orgId) redirect('/seller/onboarding');
  const rows = await listSellerPayouts(getDb(), { userId: session.userId, orgId });
  return (
    <Page width="wide">
      <PageHeader title="Payouts">
        Paid monthly once your royalties are past the 30-day hold, your KYC and bank account are verified and the total reaches the minimum. The statement shows how tax was applied. See{' '}
        <Link href="/seller/sales" className="font-semibold text-foreground underline underline-offset-4">
          sales
        </Link>{' '}
        for the entries behind it.
      </PageHeader>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payouts yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Period</Th>
              <Th num>Royalty</Th>
              <Th num>TDS</Th>
              <Th num>GST</Th>
              <Th num>Net paid</Th>
              <Th>Status</Th>
              <Th>Statement</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-background">
                <Td mono className="whitespace-nowrap">
                  {p.period}
                </Td>
                <Td num>{formatInr(p.royaltyBasePaise)}</Td>
                <Td num>{formatInr(p.tdsPaise)}</Td>
                <Td num>{p.sellerGstPaise > 0 ? formatInr(p.sellerGstPaise) : '—'}</Td>
                <Td num className="font-medium">
                  {formatInr(p.netPaise)}
                </Td>
                <Td>
                  <StatusLabel tone={STATUS[p.status].tone}>{STATUS[p.status].label}</StatusLabel>
                  {p.paidAt && (
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {fmtDate(p.paidAt)}
                      {p.utr ? ` · UTR ${p.utr}` : ''}
                    </div>
                  )}
                </Td>
                <Td>
                  {p.hasStatement ? (
                    <a href={`/seller/payouts/${p.id}/statement`} className="font-semibold underline underline-offset-4">
                      PDF
                    </a>
                  ) : (
                    '—'
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
