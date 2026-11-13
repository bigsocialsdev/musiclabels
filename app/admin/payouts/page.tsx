import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDate, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { formatInr } from '@/lib/invoicing';
import { listPayoutBatches, previousPeriod } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { computeBatchAction } from './actions';
import { BATCH_STATUS } from './labels';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Payouts | MRM Admin', robots: { index: false } };

const ERRORS: Record<string, string> = { bad_period: 'Enter a month as YYYY-MM.', compute_refused: 'That batch could not be computed: the period has not ended yet, or an earlier period has to be computed first.' };

/** Monthly payout batches (PLAN §5.6, §9). Compute is idempotent per period; a batch moves computed → approved → processing → completed. */
export default async function PayoutsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const admin = await requireAdminArea('finance', '/admin/payouts');
  const { error } = await searchParams;
  const batches = await listPayoutBatches(getDb(), admin);
  const suggested = previousPeriod(new Date());

  return (
    <Page width="wide">
      <PageHeader title="Payouts">Sellers are paid once a month, after the 30-day hold, by bank file. Review each batch line before approving it.</PageHeader>
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      <form action={computeBatchAction} className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="period" className="text-[13px] font-semibold text-muted-foreground">
            Period to compute
          </label>
          <input id="period" name="period" defaultValue={suggested} pattern="[0-9]{4}-(0[1-9]|1[0-2])" required className="h-9 w-36 rounded-md border border-input bg-card px-3 font-mono text-sm outline-none focus-visible:border-ring" />
        </div>
        <Button type="submit" variant="secondary">
          Compute batch
        </Button>
      </form>
      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No batches yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th>Lines</Th>
              <Th>Net to sellers</Th>
              <Th>Approved</Th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const s = own(BATCH_STATUS, b.status) ?? { tone: 'muted' as const, label: b.status };
              return (
                <tr key={b.id}>
                  <Td>
                    <Link href={`/admin/payouts/${b.id}`} className="font-mono font-semibold underline underline-offset-4">
                      {b.period}
                    </Link>
                  </Td>
                  <Td>
                    <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                  </Td>
                  <Td>{b.lines}</Td>
                  <Td className="whitespace-nowrap">{formatInr(b.netPaise)}</Td>
                  <Td className="whitespace-nowrap text-fg-2">{b.approvedAt ? istDate(b.approvedAt) : ''}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
