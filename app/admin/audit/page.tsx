import type { Metadata } from 'next';
import Link from 'next/link';
import { Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDateTime } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { listAuditLog, type AuditFilter } from '@/lib/audit/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Audit log | MRM Admin', robots: { index: false } };

type Params = { action?: string; entityType?: string; entityId?: string; actor?: string; from?: string; to?: string; cursor?: string };

const UUID = /^[0-9a-f-]{36}$/;
/** A `YYYY-MM-DD` filter as the start of that day in IST. */
const istDay = (v: string | undefined, plusDays = 0) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return undefined;
  return new Date(d.getTime() + plusDays * 86_400_000);
};

const field = 'h-9 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring';

/** The audit log (PLAN §9, superadmin): every admin and system action, newest first, filterable. Read-only. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const admin = await requireAdminArea('superadmin', '/admin/audit');
  const p = await searchParams;
  const filter: AuditFilter = {
    action: p.action?.trim() || undefined,
    entityType: p.entityType?.trim() || undefined,
    entityId: p.entityId?.trim() || undefined,
    actorUserId: p.actor && UUID.test(p.actor.trim()) ? p.actor.trim() : undefined,
    from: istDay(p.from),
    to: istDay(p.to, 1), // the "to" day is included
    cursor: p.cursor,
  };
  const { rows, nextCursor } = await listAuditLog(getDb(), admin, filter);
  const keep = new URLSearchParams(Object.entries({ action: p.action, entityType: p.entityType, entityId: p.entityId, actor: p.actor, from: p.from, to: p.to }).filter((e): e is [string, string] => Boolean(e[1])));

  return (
    <Page width="wide">
      <PageHeader title="Audit log">Append-only record of who did what. End an action filter with a dot (<span className="font-mono">track.</span>) to match a whole family.</PageHeader>
      <form action="/admin/audit" className="flex flex-wrap items-end gap-2">
        {(
          [
            ['action', 'Action', p.action, 'w-44'],
            ['entityType', 'Entity type', p.entityType, 'w-40'],
            ['entityId', 'Entity id', p.entityId, 'w-72'],
            ['actor', 'Actor user id', p.actor, 'w-72'],
          ] as const
        ).map(([name, label, value, width]) => (
          <div key={name} className="grid gap-1">
            <label htmlFor={name} className="text-[13px] font-semibold text-muted-foreground">
              {label}
            </label>
            <input id={name} name={name} defaultValue={value ?? ''} maxLength={100} className={`${field} ${width}`} />
          </div>
        ))}
        <div className="grid gap-1">
          <label htmlFor="from" className="text-[13px] font-semibold text-muted-foreground">
            From (IST)
          </label>
          <input id="from" name="from" type="date" defaultValue={p.from ?? ''} className={field} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="to" className="text-[13px] font-semibold text-muted-foreground">
            To (IST)
          </label>
          <input id="to" name="to" type="date" defaultValue={p.to ?? ''} className={field} />
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries match.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Entity</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td className="whitespace-nowrap text-fg-2">{istDateTime(r.at)}</Td>
                <Td className="text-[13px]">
                  {r.actorUserId ? (r.actorEmail ?? <span className="font-mono text-[12px]">{r.actorUserId}</span>) : <span className="text-muted-foreground">System</span>}
                  {r.impersonatedBy && <div className="text-[12px] text-muted-foreground">via impersonation</div>}
                  {r.ip && <div className="font-mono text-[12px] text-fg-2">{r.ip}</div>}
                </Td>
                <Td className="font-mono text-[13px] font-semibold">{r.action}</Td>
                <Td className="text-[13px]">
                  {r.entityType}
                  <div className="font-mono text-[12px] break-all text-fg-2">{r.entityId}</div>
                </Td>
                <Td>
                  {(r.before != null || r.after != null) && (
                    <details className="text-[13px]">
                      <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">Before and after</summary>
                      <pre tabIndex={0} className="mt-2 max-w-md overflow-x-auto text-[12px] text-muted-foreground">{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre>
                    </details>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {nextCursor && (
        <div>
          <Link href={`/admin/audit?${new URLSearchParams({ ...Object.fromEntries(keep), cursor: nextCursor })}`} className="text-sm font-semibold underline underline-offset-4">
            Older entries
          </Link>
        </div>
      )}
    </Page>
  );
}
