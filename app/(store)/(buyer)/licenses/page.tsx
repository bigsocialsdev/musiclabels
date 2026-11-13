import type { Metadata } from 'next';
import Link from 'next/link';
import { Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { requireBuyerSession } from '@/app/buyer-session';
import { buttonVariants } from '@/components/ui/button';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { istDate } from '@/components/store/format';
import { TIER_LABELS } from '@/lib/certificates';
import { listBuyerLicenses, type Tier } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your licenses | MRM', robots: { index: false } };

const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  active: { tone: 'ok', label: 'Active' },
  expired: { tone: 'muted', label: 'Expired' },
  revoked: { tone: 'blocked', label: 'Revoked' },
};

const href = (client: string | undefined, page: number) => {
  const q = new URLSearchParams();
  if (client) q.set('client', client);
  if (page > 1) q.set('page', String(page));
  return `/licenses${q.size ? `?${q}` : ''}`;
};

/** The buyer's licenses across every org they belong to; agencies can narrow by client name (PLAN §6.4). */
export default async function LicensesPage({ searchParams }: { searchParams: Promise<{ client?: string; page?: string }> }) {
  const sp = await searchParams;
  const session = await requireBuyerSession('/licenses');
  const client = sp.client?.trim().slice(0, 100) || undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const list = await listBuyerLicenses(getDb(), session.userId, { client, page });
  const asAgency = list.clients.length > 0 || client;

  return (
    <Page width="wide">
      <PageHeader title="Your licenses" aside={<Link href="/" className={buttonVariants({ variant: 'secondary' })}>Browse tracks</Link>}>
        Certificates, invoices, clean files and channels for everything you have licensed.
      </PageHeader>

      {asAgency && (
        <form action="/licenses" role="search" className="flex flex-wrap items-center gap-2">
          <label htmlFor="client" className="text-[13px] font-semibold text-muted-foreground">
            Client
          </label>
          <input
            id="client"
            name="client"
            list="clients"
            defaultValue={client}
            maxLength={100}
            autoComplete="off"
            placeholder="Filter by client name"
            className="h-9 w-64 max-w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring"
          />
          <datalist id="clients">
            {list.clients.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button className={buttonVariants({ variant: 'secondary' })}>Filter</button>
          {client && (
            <Link href="/licenses" className="rounded-sm px-2.5 py-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
        </form>
      )}

      {list.licenses.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <p className="text-title">{client ? `No licenses for “${client}”` : 'No licenses yet'}</p>
          <p className="mt-1 text-sm text-muted-foreground">{client ? 'Check the spelling or clear the filter.' : 'When you license a track it appears here with its certificate and invoice.'}</p>
        </div>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Track</Th>
                <Th>Tier</Th>
                <Th>Client</Th>
                <Th>Term</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.licenses.map((l) => {
                const s = STATUS[l.status]!;
                return (
                  <tr key={l.id}>
                    <Td>
                      <Link href={`/licenses/${l.id}`} className="font-semibold hover:underline">
                        {l.trackTitle}
                      </Link>
                      <div className="text-[13px] text-muted-foreground">{l.primaryArtist}</div>
                    </Td>
                    <Td>{TIER_LABELS[l.tier as Tier]}</Td>
                    <Td className="text-muted-foreground">{l.clientName ?? '—'}</Td>
                    <Td mono className="whitespace-nowrap text-fg-2">
                      {l.endsAt ? `${istDate(l.startsAt)} to ${istDate(l.endsAt)}` : `From ${istDate(l.startsAt)}`}
                    </Td>
                    <Td>
                      <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                    </Td>
                    <Td>
                      <Link href={`/licenses/${l.id}`} className="text-[13px] font-semibold underline-offset-4 hover:underline">
                        Open
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {list.pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={href(client, page - 1)} rel="prev" className="rounded-sm px-3 py-2 font-semibold hover:bg-secondary">
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="font-mono text-[13px] font-normal text-muted-foreground">
                {list.page} of {list.pages}
              </span>
              {page < list.pages ? (
                <Link href={href(client, page + 1)} rel="next" className="rounded-sm px-3 py-2 font-semibold hover:bg-secondary">
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </Page>
  );
}
