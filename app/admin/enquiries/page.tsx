import type { Metadata } from 'next';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { docActionClass } from '@/components/store/doc-row';
import { istDateTime, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { ENQUIRY_STATUSES, ENQUIRY_TRANSITIONS, listEnquiries, type EnquiryStatus } from '@/lib/enquiries/server';
import { getDb } from '@/lib/platform/db';
import { requireAnyAdminArea } from '../guard';
import { setEnquiryStatusAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Enquiries | MRM Admin', robots: { index: false } };

const STATUS: Record<EnquiryStatus, { tone: StatusTone; label: string }> = {
  new: { tone: 'attention', label: 'New' },
  contacted: { tone: 'info', label: 'Contacted' },
  closed_won: { tone: 'ok', label: 'Won' },
  closed_lost: { tone: 'muted', label: 'Lost' },
};
const MOVE: Record<EnquiryStatus, string> = { new: 'New', contacted: 'Mark contacted', closed_won: 'Close as won', closed_lost: 'Close as lost' };
const ERRORS: Record<string, string> = { moved: 'That enquiry has already moved on.' };

/** Commercial and Broadcast enquiries (PLAN §6.1, §9): the sales pipeline, open to any admin. These are leads; nothing is sold from here. */
export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string; done?: string; error?: string }> }) {
  const admin = await requireAnyAdminArea('/admin/enquiries');
  const { status, done, error } = await searchParams;
  const filter = ENQUIRY_STATUSES.find((s) => s === status);
  const rows = await listEnquiries(getDb(), admin, filter);

  return (
    <Page width="wide">
      <PageHeader title="Enquiries">Commercial and Broadcast leads from track pages, oldest first. Follow up by email or phone; there is no checkout for these.</PageHeader>
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      {done && Object.hasOwn(STATUS, done) && (
        <Notice tone="ok" role="status">
          Moved to {STATUS[done as EnquiryStatus].label.toLowerCase()}.
        </Notice>
      )}
      <form className="flex flex-wrap items-center gap-2" action="/admin/enquiries">
        <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={filter ?? ''} className="h-9 w-44 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring">
          <option value="">All</option>
          {ENQUIRY_STATUSES.map((s) => (
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
        <p className="text-sm text-muted-foreground">No enquiries in this view.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Enquirer</Th>
              <Th>Use</Th>
              <Th>Status</Th>
              <Th>Received</Th>
              <Th>Move to</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const s = STATUS[e.status as EnquiryStatus];
              const next = ENQUIRY_TRANSITIONS.filter((t) => t.from === e.status).map((t) => t.to);
              return (
                <tr key={e.id} className="align-top">
                  <Td>
                    <div className="font-semibold">{e.contactName}</div>
                    <a href={`mailto:${e.contactEmail}`} className="text-[13px] underline underline-offset-4">
                      {e.contactEmail}
                    </a>
                    {e.contactPhone && <div className="text-[13px] text-muted-foreground">{e.contactPhone}</div>}
                    <div className="font-mono text-[12px] text-fg-2">track {e.trackId}</div>
                  </Td>
                  <Td className="max-w-md text-[13px]">
                    <div className="font-semibold uppercase">{e.media}</div>
                    <p className="break-words whitespace-pre-wrap">{e.intendedUse}</p>
                    {e.budgetRange && <div className="text-muted-foreground">Budget {e.budgetRange}</div>}
                  </Td>
                  <Td>
                    <StatusLabel tone={s?.tone ?? 'muted'}>{s?.label ?? e.status}</StatusLabel>
                  </Td>
                  <Td className="whitespace-nowrap text-fg-2">{istDateTime(e.createdAt)}</Td>
                  <Td>
                    <div className="grid gap-2">
                      {next.map((to) => (
                        <form key={to} action={setEnquiryStatusAction.bind(null, e.id, to)}>
                          <button className={docActionClass}>{MOVE[to]}</button>
                        </form>
                      ))}
                    </div>
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
