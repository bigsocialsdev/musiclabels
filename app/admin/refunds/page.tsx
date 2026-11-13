import type { Metadata } from 'next';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { docActionClass } from '@/components/store/doc-row';
import { istDate, istDateTime, own } from '@/components/store/format';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { listRefundEligibleDisputes } from '@/lib/disputes/server';
import { formatInr } from '@/lib/invoicing';
import { listRefunds } from '@/lib/payments/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { approveDisputeRefundAction, retryRefundAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Refunds | MRM Admin', robots: { index: false } };

const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  requested: { tone: 'attention', label: 'Requested' },
  processing: { tone: 'info', label: 'With Razorpay' },
  processed: { tone: 'ok', label: 'Refunded' },
  failed: { tone: 'blocked', label: 'Failed' },
};
const DONE: Record<string, string> = { approved: 'Refund approved. It is being sent to Razorpay.', retry: 'Refund re-sent. Its status updates when Razorpay confirms.' };
const ERRORS: Record<string, string> = {
  refund_unavailable: 'That dispute can no longer be refunded: it moved on, or its order is already refunded.',
  refund_settled: 'That refund is already with Razorpay or done, so it cannot be sent again.',
};

/** Refunds (PLAN §9, finance): disputes waiting for approval, then every refund and where it stands. Refunds are full-order only. */
export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdminArea('finance', '/admin/refunds');
  const { done, error } = await searchParams;
  const db = getDb();
  const [eligible, refunds] = await Promise.all([listRefundEligibleDisputes(db, admin), listRefunds(db, admin)]);

  return (
    <Page width="wide">
      <PageHeader title="Refunds">Approving a refund returns the full order amount, issues the credit note, revokes the license and reverses the seller royalty together.</PageHeader>
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      {own(DONE, done) && (
        <Notice tone="ok" role="status">
          {own(DONE, done)}
        </Notice>
      )}

      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Waiting for approval</h2>
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No disputes are waiting for a refund.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>License</Th>
                <Th>Eligible since</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {eligible.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <div className="font-semibold">{d.trackTitle}</div>
                    <div className="font-mono text-[12px] text-fg-2">{d.licensePublicId}</div>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-2">{d.refundEligibleAt ? istDateTime(d.refundEligibleAt) : ''}</Td>
                  <Td>
                    <form action={approveDisputeRefundAction.bind(null, d.id)}>
                      <button className={docActionClass}>Approve full refund</button>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-base font-semibold">All refunds</h2>
        {refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No refunds yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>License</Th>
                <Th>Reason</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Requested</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {refunds.map(({ refund: r, licensePublicId, trackTitle }) => {
                const s = STATUS[r.status] ?? { tone: 'muted' as StatusTone, label: r.status };
                return (
                  <tr key={r.id} className="align-top">
                    <Td>
                      {trackTitle ? (
                        <>
                          <div className="font-semibold">{trackTitle}</div>
                          <div className="font-mono text-[12px] text-fg-2">{licensePublicId}</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Never fulfilled</span>
                      )}
                    </Td>
                    <Td className="text-[13px]">
                      {r.reason.replaceAll('_', ' ')}
                      {r.note && <div className="text-muted-foreground">{r.note}</div>}
                    </Td>
                    <Td className="whitespace-nowrap">{formatInr(r.amountPaise)}</Td>
                    <Td>
                      <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                      {r.lastError && <div className="mt-1 max-w-xs text-[12px] break-words text-muted-foreground">{r.lastError}</div>}
                    </Td>
                    <Td className="whitespace-nowrap text-fg-2">{istDate(r.createdAt)}</Td>
                    <Td>
                      {(r.status === 'requested' || r.status === 'failed') && (
                        <form action={retryRefundAction.bind(null, r.id)}>
                          <button className={docActionClass}>Send again</button>
                        </form>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </Page>
  );
}
