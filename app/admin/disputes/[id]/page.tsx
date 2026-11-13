import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { istDateTime, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { getDisputeDetail, type DisputeStatus } from '@/lib/disputes/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../../guard';
import { DISPUTE_STATUS_LABEL } from '../labels';
import { claimantCatalogedAction, firstActionAction, resolveDisputeAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dispute | MRM Admin', robots: { index: false } };

const DONE: Record<string, string> = {
  first_action: 'First action recorded; the buyer was told.',
  resolved: 'Outcome recorded; the buyer was told.',
  cataloged: 'Claimant flag updated.',
};
const textarea = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring';

/** One dispute: its facts, the full event log (internal events included) and the actions its status allows. */
export default async function DisputePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string }> }) {
  const { id } = await params;
  const { done, error } = await searchParams;
  const admin = await requireAdminArea('disputes', `/admin/disputes/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const view = await getDisputeDetail(getDb(), admin, id);
  if (!view) notFound();
  const { dispute: d, events, overdue } = view;
  const s = DISPUTE_STATUS_LABEL[d.status as DisputeStatus];

  return (
    <Page>
      <PageHeader
        title={
          <>
            Dispute <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
          </>
        }
      >
        {d.disputeType.replaceAll('_', ' ')} on {d.platform}, claimed by {d.claimantName}.
      </PageHeader>
      {error && (
        <Notice tone="attention" role="alert">
          {error}
        </Notice>
      )}
      {own(DONE, done) && (
        <Notice tone="ok" role="status">
          {own(DONE, done)}
        </Notice>
      )}
      {overdue && <Notice tone="blocked">Past a due date. First action by {istDateTime(d.firstActionDueAt)}{d.resolutionDueAt ? `, resolution target ${istDateTime(d.resolutionDueAt)}` : ''}.</Notice>}

      <dl className="grid gap-1.5 rounded-lg border bg-card p-5 text-sm">
        {(
          [
            ['Video', d.videoUrl],
            ['Reported', istDateTime(d.createdAt)],
            ['First action by', istDateTime(d.firstActionDueAt)],
            ['Resolution target', d.resolutionDueAt ? istDateTime(d.resolutionDueAt) : 'None (no seller contract backs this track)'],
            ['Refund eligible from', istDateTime(d.refundEligibleAt)],
            ['Class at open', d.clearanceClassAtOpen],
            ['Claimant in our catalog', d.claimantCataloged ? 'Yes' : 'No'],
            ...(d.resolution ? [['Closing note', d.resolution]] : []),
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-x-3">
            <dt className="w-44 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-all">{v}</dd>
          </div>
        ))}
      </dl>

      {d.status === 'open' && (
        <form action={firstActionAction.bind(null, d.id)} className="space-y-2 rounded-lg border bg-card p-5">
          <h2 className="text-title">Record the first action</h2>
          <textarea name="note" required maxLength={2000} rows={2} placeholder="What was done: seller contacted, platform ticket raised" className={textarea} />
          <Button type="submit">Record first action</Button>
        </form>
      )}
      {d.status === 'in_progress' && (
        <form action={resolveDisputeAction.bind(null, d.id)} className="space-y-2 rounded-lg border bg-card p-5">
          <h2 className="text-title">Record the outcome</h2>
          <select name="resolution" defaultValue="released" className={selectClass}>
            <option value="released">Released with the platform</option>
            <option value="denied">Closed without a release</option>
            <option value="kit_issued">Dispute kit issued</option>
          </select>
          <textarea name="note" required maxLength={2000} rows={2} placeholder="The note the buyer will see" className={textarea} />
          <Button type="submit">Record outcome</Button>
        </form>
      )}
      {d.status === 'refund_eligible' && <Notice tone="info">This dispute is refund eligible. Finance approves the refund from the Refunds area.</Notice>}

      <form action={claimantCatalogedAction.bind(null, d.id, !d.claimantCataloged)}>
        <Button type="submit" variant="secondary">
          {d.claimantCataloged ? 'Claimant is not in our catalog' : 'Claimant is in our catalog'}
        </Button>
      </form>

      <section className="space-y-2">
        <h2 className="text-title">Events</h2>
        <ul className="divide-y rounded-lg border bg-card text-[13px]">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-x-4 px-4 py-2">
              <span>
                <span className="font-semibold">{e.kind.replaceAll('_', ' ')}</span>
                {e.note && <span className="text-muted-foreground"> · {e.note}</span>}
              </span>
              <span className="text-fg-2">{istDateTime(e.at)}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/admin/disputes" className="inline-block text-sm font-semibold text-muted-foreground hover:text-foreground">
        ← All disputes
      </Link>
    </Page>
  );
}
