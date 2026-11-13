import type { Metadata } from 'next';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { docActionClass } from '@/components/store/doc-row';
import { istDate, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { CLEARANCE_STATUSES, listClearanceQueue, type ClearanceStatus } from '@/lib/clearance/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { escalateClearanceAction, resendClearanceAction, resolveClearanceAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Clearance | MRM Admin', robots: { index: false } };

const STATUS: Record<ClearanceStatus, { tone: StatusTone; label: string }> = {
  not_required: { tone: 'muted', label: 'Not required' },
  pending: { tone: 'attention', label: 'To send' },
  sent: { tone: 'info', label: 'Sent' },
  overdue: { tone: 'blocked', label: 'Overdue' },
  escalated: { tone: 'blocked', label: 'Escalated' },
  completed: { tone: 'ok', label: 'Completed' },
  failed: { tone: 'muted', label: 'Declined' },
};
const DONE: Record<string, string> = {
  resent: 'A fresh link was sent to the seller.',
  escalated: 'Escalated: ops now owns this request.',
  released: 'Recorded as released.',
  declined: 'Recorded as declined.',
};
const OPEN: readonly ClearanceStatus[] = ['sent', 'overdue', 'escalated'];

/** Clearance queue (PLAN §9): requests by status and age, resend, escalate, and record an outcome with the evidence. */
export default async function ClearanceQueue({ searchParams }: { searchParams: Promise<{ status?: string; done?: string; error?: string }> }) {
  const admin = await requireAdminArea('clearance', '/admin/clearance');
  const { status, done, error } = await searchParams;
  const filter = CLEARANCE_STATUSES.includes(status as ClearanceStatus) ? (status as ClearanceStatus) : undefined;
  const rows = await listClearanceQueue(getDb(), admin, { status: filter });

  return (
    <Page width="wide">
      <PageHeader title="Clearance">Requests to rights holders by status, oldest due first. Class A tracks need none.</PageHeader>
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
      <form className="flex flex-wrap items-center gap-2" action="/admin/clearance">
        <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={filter ?? ''} className="h-9 w-44 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring">
          <option value="">All open work</option>
          {CLEARANCE_STATUSES.filter((s) => s !== 'not_required').map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this view.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Request</Th>
              <Th>Seller</Th>
              <Th>Status</Th>
              <Th>Due</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = STATUS[r.status];
              const open = OPEN.includes(r.status);
              return (
                <tr key={r.id} className="align-top">
                  <Td>
                    <div className="font-semibold">{r.target}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {r.trackTitle} · {r.scope} · class {r.clearanceClass}
                    </div>
                    <div className="font-mono text-[12px] font-normal text-fg-2">{r.licensePublicId}</div>
                    {r.lastError && <div className="text-[13px] text-muted-foreground">Last error: {r.lastError}</div>}
                  </Td>
                  <Td>{r.seller}</Td>
                  <Td>
                    <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-2">
                    {r.dueAt ? istDate(r.dueAt) : '—'}
                    {(r.status === 'overdue' || r.status === 'escalated') && <div className="text-[13px] text-muted-foreground">past due</div>}
                  </Td>
                  <Td>
                    {open && (
                      <div className="grid gap-2">
                        <div className="flex gap-1">
                          <form action={resendClearanceAction.bind(null, r.id)}>
                            <button className={docActionClass}>Resend link</button>
                          </form>
                          {r.status === 'overdue' && (
                            <form action={escalateClearanceAction.bind(null, r.id)}>
                              <button className={docActionClass}>Escalate</button>
                            </form>
                          )}
                        </div>
                        <details className="text-[13px]">
                          <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">Record outcome</summary>
                          <form action={resolveClearanceAction.bind(null, r.id)} className="mt-2 grid gap-2">
                            <select name="outcome" className={selectClass} defaultValue="released">
                              <option value="released">Released</option>
                              <option value="declined">Declined</option>
                            </select>
                            <textarea
                              name="note"
                              required
                              minLength={3}
                              maxLength={2000}
                              rows={2}
                              placeholder="Evidence: who said what, when"
                              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring"
                            />
                            <div>
                              <Button type="submit" variant="secondary">
                                Record
                              </Button>
                            </div>
                          </form>
                        </details>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
