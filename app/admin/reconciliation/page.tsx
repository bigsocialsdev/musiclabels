import type { Metadata } from 'next';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDateTime, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { listReconciliationItems } from '@/lib/payments/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { resolveItemAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reconciliation | MRM Admin', robots: { index: false } };

const KINDS: Record<string, string> = {
  unknown_payment: 'Payment with no matching order',
  captured_not_paid: 'Captured at Razorpay, order not marked paid',
  amount_mismatch: 'Captured amount differs from the order',
  paid_without_capture: 'Order marked paid, no capture at Razorpay',
  duplicate_payment: 'More than one payment for one order',
};
const DONE: Record<string, string> = { resolved: 'Item closed with your note.' };
const ERRORS: Record<string, string> = { no_note: 'Write what was done about it.', closed: 'That item was already closed.' };

/** Mismatches the daily reconciliation found against Razorpay (PLAN §5.7). Resolving records what finance did; it moves no money. */
export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdminArea('finance', '/admin/reconciliation');
  const { done, error } = await searchParams;
  const items = await listReconciliationItems(getDb(), admin);

  return (
    <Page width="wide">
      <PageHeader title="Reconciliation">Open items need a person. Fix the cause (refund, mark paid through the normal flow, or contact Razorpay), then close the item with a note.</PageHeader>
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
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to reconcile.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Mismatch</Th>
              <Th>Status</Th>
              <Th>Found</Th>
              <Th>Resolve</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="align-top">
                <Td>
                  <div className="font-semibold">{own(KINDS, i.kind) ?? i.kind}</div>
                  <div className="font-mono text-[12px] text-fg-2">{i.gatewayRef}</div>
                  {i.orderId && <div className="font-mono text-[12px] text-fg-2">order {i.orderId}</div>}
                  <pre tabIndex={0} className="mt-1 max-w-md overflow-x-auto text-[12px] text-muted-foreground">{JSON.stringify(i.details, null, 1)}</pre>
                </Td>
                <Td>
                  <StatusLabel tone={i.status === 'open' ? 'attention' : 'ok'}>{i.status === 'open' ? 'Open' : 'Resolved'}</StatusLabel>
                  {i.resolutionNote && <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">{i.resolutionNote}</p>}
                </Td>
                <Td className="whitespace-nowrap text-fg-2">{istDateTime(i.createdAt)}</Td>
                <Td>
                  {i.status === 'open' && (
                    <form action={resolveItemAction.bind(null, i.id)} className="grid gap-2">
                      <textarea name="note" required maxLength={2000} rows={2} placeholder="What was done" aria-label="Resolution note" className="w-full min-w-56 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring" />
                      <div>
                        <Button type="submit" variant="secondary">
                          Close item
                        </Button>
                      </div>
                    </form>
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
