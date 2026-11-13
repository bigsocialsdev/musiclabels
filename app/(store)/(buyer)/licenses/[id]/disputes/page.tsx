import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { requireBuyerSession } from '@/app/buyer-session';
import { PLATFORM_LABELS, istDateTime, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { DISPUTE_TYPES, getBuyerDisputeEvents, isDisputeOverdue, listBuyerDisputes, type DisputeStatus } from '@/lib/disputes/server';
import { getLicenseForBuyer, resolveBuyerActor } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { openDisputeAction } from '../usage-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Claims and strikes | MRM', robots: { index: false } };

const TYPE_LABELS: Record<string, string> = {
  content_id_claim: 'Content ID or copyright claim',
  copyright_strike: 'Copyright strike',
  mute: 'Audio muted',
  ad_rejection: 'Ad rejected',
  other: 'Other',
};
const STATUS: Record<DisputeStatus, { tone: StatusTone; label: string }> = {
  open: { tone: 'attention', label: 'Open' },
  in_progress: { tone: 'info', label: 'In progress' },
  resolved_released: { tone: 'ok', label: 'Released' },
  resolved_denied: { tone: 'muted', label: 'Closed, not released' },
  refund_eligible: { tone: 'attention', label: 'Refund available' },
  resolved_refunded: { tone: 'ok', label: 'Refunded' },
  resolved_kit_issued: { tone: 'info', label: 'Dispute kit issued' },
};
// Only these events are the buyer's to see; internal bookkeeping rows stay with ops.
const EVENT_LABELS: Record<string, string> = {
  opened: 'You reported it',
  first_action: 'Our team picked it up',
  release: 'Released with the platform',
  deny: 'Closed without a release',
  issue_kit: 'Dispute kit issued',
  make_refund_eligible: 'Refund became available',
  refund_processed: 'Refund processed',
};
const ERRORS: Record<string, string> = {
  invalid_dispute: 'Enter the video link (starting with https://), the platform, the kind of claim and who made it.',
  duplicate_open_dispute: 'You already reported this claim and it is still open.',
  license_revoked: 'This license has been revoked, so claims can no longer be reported here.',
  rate_limited: 'Too many reports in a short time. Try again in a few minutes.',
  not_found: 'That license was not found.',
};

/** Reporting a claim or strike against a use of the license, and following it (PLAN §5.4). Due dates are fixed when the report is made. */
export default async function DisputesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { id } = await params;
  const { error, done } = await searchParams;
  const session = await requireBuyerSession(`/licenses/${id}/disputes`);
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const actor = await resolveBuyerActor(db, session.userId, id);
  const view = actor ? await getLicenseForBuyer(db, actor, id) : null;
  if (!actor || !view) notFound();
  const disputes = await listBuyerDisputes(db, actor, id);
  const events = await Promise.all(disputes.map((d) => getBuyerDisputeEvents(db, actor, d.id)));
  const now = new Date();
  const revoked = view.license.effectiveStatus === 'revoked';
  const urls = view.videos.flatMap((v) => v.urls);

  return (
    <Page width="wide">
      <PageHeader title="Claims and strikes">
        {view.license.trackTitle}. Report a claim, mute or strike a platform has placed on a video that uses this license, and follow it here.
      </PageHeader>
      {error && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error) ?? 'Something went wrong.'}
        </Notice>
      )}
      {done === 'opened' && (
        <Notice tone="ok" role="status">
          Reported. We record a first action within one business day. The dates are below.
        </Notice>
      )}

      {!revoked && (
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h2 className="text-title">Report a claim</h2>
          <form action={openDisputeAction.bind(null, id)} className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground sm:col-span-2">
              Video link
              <input name="videoUrl" type="url" required list="registered-urls" placeholder="https://" autoComplete="off" className={selectClass} />
              <datalist id="registered-urls">
                {urls.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </label>
            <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">
              Platform
              <select name="platform" className={selectClass}>
                {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground">
              What happened
              <select name="disputeType" className={selectClass}>
                {DISPUTE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[13px] font-semibold text-muted-foreground sm:col-span-2">
              Who made the claim
              <input name="claimantName" required maxLength={200} autoComplete="off" placeholder="The name the platform shows" className={selectClass} />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">Report claim</Button>
            </div>
          </form>
        </section>
      )}

      {disputes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No claims reported on this license.</p>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Claim</Th>
                <Th>Status</Th>
                <Th>First action by</Th>
                <Th>Resolution target</Th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d, i) => {
                const s = STATUS[d.status as DisputeStatus] ?? STATUS.open;
                // Due dates are targets for a claim still being worked: refund-available and kit-issued claims have moved past them.
                const live = d.status === 'open' || d.status === 'in_progress';
                const overdue = isDisputeOverdue(d, now);
                const log = (events[i] ?? []).filter((e) => EVENT_LABELS[e.kind]);
                return (
                  <tr key={d.id} className="align-top">
                    <Td>
                      <div className="font-semibold">{TYPE_LABELS[d.disputeType] ?? d.disputeType}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {d.claimantName} · {PLATFORM_LABELS[d.platform] ?? d.platform}
                      </div>
                      <div className="max-w-xs text-[13px] break-all text-muted-foreground">{d.videoUrl}</div>
                      <details className="mt-1.5 text-[13px]">
                        <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">History ({log.length})</summary>
                        <ul className="mt-1.5 divide-y">
                          {log.map((e, n) => (
                            <li key={n} className="flex flex-wrap justify-between gap-x-4 py-1">
                              <span>{EVENT_LABELS[e.kind]}</span>
                              <span className="text-fg-2">{istDateTime(e.at)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </Td>
                    <Td>
                      <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                      {overdue && <div className="mt-1 text-[13px] text-muted-foreground">Past its target date</div>}
                      {d.resolution && <div className="mt-1 max-w-56 text-[13px] text-muted-foreground">Note from our team: {d.resolution}</div>}
                    </Td>
                    <Td className="whitespace-nowrap text-fg-2">{d.status === 'open' ? istDateTime(d.firstActionDueAt) : '—'}</Td>
                    <Td className="whitespace-nowrap text-fg-2">{!live ? '—' : d.resolutionDueAt ? istDateTime(d.resolutionDueAt) : 'No target'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="max-w-[70ch] text-[13px] text-muted-foreground">
            A resolution target applies only to tracks whose rights holder is under contract with us. A platform decides a claim on its own clock, so we cannot promise an outcome. If a claim goes unresolved in time and qualifies, its status changes to Refund available.
          </p>
        </>
      )}

      <Link href={`/licenses/${id}`} className="inline-block text-sm font-semibold text-muted-foreground hover:text-foreground">
        ← Back to the license
      </Link>
    </Page>
  );
}
