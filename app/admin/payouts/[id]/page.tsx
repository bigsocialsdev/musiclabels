import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { docActionClass } from '@/components/store/doc-row';
import { istDate, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { formatInr } from '@/lib/invoicing';
import { getPayoutBatchDetail } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../../guard';
import { approveBatchAction, downloadBankFileAction, recordFailedAction, recordPaidAction, submitBatchAction } from '../actions';
import { BATCH_STATUS, LINE_STATUS } from '../labels';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Payout batch | MRM Admin', robots: { index: false } };

const DONE: Record<string, string> = {
  computed: 'Batch computed. Review the lines, then approve it.',
  exists: 'That period already has a batch.',
  approved: 'Batch approved. Submit it to produce the bank file.',
  submitted: 'Batch submitted.',
  paid: 'Payment recorded. The seller has been emailed.',
  failed: 'Line marked failed. Its royalty carries into the next run.',
};
const ERRORS: Record<string, string> = {
  not_computed: 'That batch is no longer waiting for approval.',
  not_approved: 'Only an approved batch can be submitted.',
  no_file: 'No bank file exists yet: submit the batch first.',
  bad_utr: 'A UTR is 6 to 30 letters and digits.',
  no_reason: 'Say why the payment failed.',
  not_processing: 'That line is no longer with the bank.',
};

/** One batch: every seller line, plus the finance actions its status allows. */
export default async function PayoutBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string; sent?: string; held?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const admin = await requireAdminArea('finance', `/admin/payouts/${id}`);
  const { done, error, sent, held } = await searchParams;
  const detail = await getPayoutBatchDetail(getDb(), admin, id);
  if (!detail) notFound();
  const { batch, lines } = detail;
  const s = own(BATCH_STATUS, batch.status) ?? { tone: 'muted' as const, label: batch.status };
  const total = lines.reduce((n, l) => n + l.netPaise, 0);
  const heldCount = Number(held ?? 0);

  return (
    <Page width="wide">
      <PageHeader title={`Payouts ${batch.period}`} aside={<StatusLabel tone={s.tone}>{s.label}</StatusLabel>}>
        <Link href="/admin/payouts" className="underline underline-offset-4">
          All batches
        </Link>
        {' · '}
        {lines.length} {lines.length === 1 ? 'line' : 'lines'}, {formatInr(total)} net. Cutoff {istDate(batch.cutoffAt)}.
      </PageHeader>
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      {own(DONE, done) && (
        <Notice tone="ok" role="status">
          {own(DONE, done)} {done === 'submitted' && `${Number(sent ?? 0)} sent.`}
        </Notice>
      )}
      {done === 'submitted' && heldCount > 0 && (
        <Notice tone="attention" role="status">
          {heldCount} {heldCount === 1 ? 'line was' : 'lines were'} held back because the seller bank account is no longer verified. Re-verify it and submit again, or mark the line failed.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        {batch.status === 'computed' && (
          <form action={approveBatchAction.bind(null, batch.id)}>
            <Button type="submit">Approve batch</Button>
          </form>
        )}
        {(batch.status === 'approved' || batch.status === 'processing') && (
          <form action={submitBatchAction.bind(null, batch.id)}>
            <Button type="submit">{batch.status === 'approved' ? 'Submit batch' : 'Submit remaining lines'}</Button>
          </form>
        )}
        {batch.railFileKey && (
          <form action={downloadBankFileAction.bind(null, batch.id)}>
            <Button type="submit" variant="secondary">
              Download bank file
            </Button>
          </form>
        )}
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Seller</Th>
            <Th>Royalty</Th>
            <Th>TDS</Th>
            <Th>GST</Th>
            <Th>Net</Th>
            <Th>Status</Th>
            <Th>Record result</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const ls = own(LINE_STATUS, l.status) ?? { tone: 'muted' as const, label: l.status };
            return (
              <tr key={l.id} className="align-top">
                <Td className="font-semibold">{l.seller}</Td>
                <Td className="whitespace-nowrap">{formatInr(l.royaltyBasePaise)}</Td>
                <Td className="whitespace-nowrap">{formatInr(l.tdsPaise)}</Td>
                <Td className="whitespace-nowrap">
                  {formatInr(l.sellerGstPaise)}
                  {l.rcmGstPaise > 0 && <div className="text-[12px] text-muted-foreground">RCM {formatInr(l.rcmGstPaise)}</div>}
                </Td>
                <Td className="whitespace-nowrap font-semibold">{formatInr(l.netPaise)}</Td>
                <Td>
                  <StatusLabel tone={ls.tone}>{ls.label}</StatusLabel>
                  {l.utr && <div className="mt-1 font-mono text-[12px] text-fg-2">UTR {l.utr}</div>}
                  {l.failureReason && <div className="mt-1 max-w-xs text-[12px] break-words text-muted-foreground">{l.failureReason}</div>}
                </Td>
                <Td>
                  {l.status === 'processing' && (
                    <form action={recordPaidAction.bind(null, batch.id, l.id)} className="flex items-center gap-2">
                      <input name="utr" required minLength={6} maxLength={30} placeholder="Bank UTR" aria-label={`UTR for ${l.seller}`} className="h-9 w-40 rounded-md border border-input bg-card px-3 font-mono text-sm outline-none focus-visible:border-ring" />
                      <button className={docActionClass}>Record paid</button>
                    </form>
                  )}
                  {(l.status === 'pending' || l.status === 'processing') && (
                    <details className="mt-2 text-[13px]">
                      <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">Mark failed</summary>
                      <form action={recordFailedAction.bind(null, batch.id, l.id)} className="mt-2 flex items-center gap-2">
                        <input name="reason" required maxLength={500} placeholder="Reason" aria-label={`Failure reason for ${l.seller}`} className="h-9 w-48 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring" />
                        <button className={docActionClass}>Mark failed</button>
                      </form>
                    </details>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Page>
  );
}
