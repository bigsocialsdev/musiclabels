import type { Metadata } from 'next';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { docActionClass } from '@/components/store/doc-row';
import { istDateTime, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { COMPLAINT_STATUSES, listComplaints, type ComplaintStatus } from '@/lib/disputes/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { investigateAction, resolveComplaintAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Copyright complaints | MRM Admin', robots: { index: false } };

const STATUS: Record<ComplaintStatus, { tone: StatusTone; label: string }> = {
  received: { tone: 'attention', label: 'Received' },
  investigating: { tone: 'info', label: 'Investigating' },
  upheld: { tone: 'ok', label: 'Upheld' },
  rejected: { tone: 'muted', label: 'Rejected' },
};
const DONE: Record<string, string> = { investigating: 'You are now the grievance officer for this complaint.', upheld: 'Upheld. A named track was suspended and ops was alerted to review its licenses.', rejected: 'Rejected.' };

/** Public copyright complaints (PLAN §5.5), oldest first. Upholding one about a track suspends it; existing licenses are untouched. */
export default async function ComplaintsQueue({ searchParams }: { searchParams: Promise<{ status?: string; done?: string; error?: string }> }) {
  const admin = await requireAdminArea('disputes', '/admin/complaints');
  const { status, done, error } = await searchParams;
  const filter = COMPLAINT_STATUSES.includes(status as ComplaintStatus) ? (status as ComplaintStatus) : undefined;
  const rows = await listComplaints(getDb(), admin, filter);

  return (
    <Page width="wide">
      <PageHeader title="Copyright complaints">Intake from the public form. Upholding a complaint that names a track suspends it.</PageHeader>
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
      <form className="flex flex-wrap items-center gap-2" action="/admin/complaints">
        <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={filter ?? ''} className="h-9 w-44 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring">
          <option value="">All</option>
          {COMPLAINT_STATUSES.map((s) => (
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
        <p className="text-sm text-muted-foreground">No complaints in this view.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Complaint</Th>
              <Th>Status</Th>
              <Th>Received</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const s = STATUS[c.status as ComplaintStatus];
              const open = c.status === 'received' || c.status === 'investigating';
              return (
                <tr key={c.id} className="align-top">
                  <Td>
                    <div className="font-semibold">{c.complainantName}</div>
                    <div className="text-[13px] text-muted-foreground">{c.complainantEmail}</div>
                    <p className="mt-1 max-w-md text-[13px] break-words">{c.workClaimed}</p>
                    {c.trackId && <div className="font-mono text-[12px] font-normal text-fg-2">track {c.trackId}</div>}
                    {c.outcomeNote && <p className="mt-1 text-[13px] text-muted-foreground">Outcome: {c.outcomeNote}</p>}
                  </Td>
                  <Td>
                    <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-2">{istDateTime(c.receivedAt)}</Td>
                  <Td>
                    {open && (
                      <div className="grid gap-2">
                        {c.status === 'received' && (
                          <form action={investigateAction.bind(null, c.id)}>
                            <button className={docActionClass}>Start investigating</button>
                          </form>
                        )}
                        <details className="text-[13px]">
                          <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">Record outcome</summary>
                          <form action={resolveComplaintAction.bind(null, c.id)} className="mt-2 grid gap-2">
                            <select name="outcome" className={selectClass} defaultValue="rejected">
                              <option value="rejected">Reject</option>
                              {c.status === 'investigating' && <option value="upheld">Uphold</option>}
                            </select>
                            <textarea name="note" required maxLength={2000} rows={2} placeholder="Outcome note" className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring" />
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
