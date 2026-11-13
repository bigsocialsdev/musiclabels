import type { Metadata } from 'next';
import Link from 'next/link';
import { Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDateTime } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { DISPUTE_STATUSES, listDisputes, type DisputeStatus } from '@/lib/disputes/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { DISPUTE_STATUS_LABEL } from './labels';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Disputes | MRM Admin', robots: { index: false } };

/** Disputes queue (PLAN §9): first-action and resolution due dates, with an overdue filter derived from them. */
export default async function DisputesQueue({ searchParams }: { searchParams: Promise<{ status?: string; overdue?: string }> }) {
  const admin = await requireAdminArea('disputes', '/admin/disputes');
  const sp = await searchParams;
  const status = DISPUTE_STATUSES.includes(sp.status as DisputeStatus) ? (sp.status as DisputeStatus) : undefined;
  const rows = await listDisputes(getDb(), admin, { status, overdueOnly: sp.overdue === '1' });

  return (
    <Page width="wide">
      <PageHeader title="Disputes">Claims and strikes reported by buyers, nearest due date first.</PageHeader>
      <form className="flex flex-wrap items-center gap-2" action="/admin/disputes">
        <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={status ?? ''} className="h-9 w-44 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring">
          <option value="">All</option>
          {DISPUTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DISPUTE_STATUS_LABEL[s].label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
          <input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === '1'} /> Overdue only
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No disputes in this view.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Dispute</Th>
              <Th>Status</Th>
              <Th>First action by</Th>
              <Th>Resolution target</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const s = DISPUTE_STATUS_LABEL[d.status as DisputeStatus];
              return (
                <tr key={d.id}>
                  <Td>
                    <Link href={`/admin/disputes/${d.id}`} className="font-semibold hover:underline">
                      {d.trackTitle}
                    </Link>
                    <div className="text-[13px] text-muted-foreground">
                      {d.disputeType.replaceAll('_', ' ')} · {d.claimantName} · {d.platform}
                    </div>
                    <div className="font-mono text-[12px] font-normal text-fg-2">{d.licensePublicId}</div>
                  </Td>
                  <Td>
                    <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                    {d.overdue && <div className="mt-1 text-[13px] text-blocked">Overdue</div>}
                  </Td>
                  <Td className="whitespace-nowrap text-fg-2">{d.status === 'open' ? istDateTime(d.firstActionDueAt) : '—'}</Td>
                  <Td className="whitespace-nowrap text-fg-2">{d.resolutionDueAt && (d.status === 'open' || d.status === 'in_progress') ? istDateTime(d.resolutionDueAt) : '—'}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
