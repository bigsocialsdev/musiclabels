import type { Metadata } from 'next';
import Link from 'next/link';
import { Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { MIN_SEARCH_LENGTH, searchAccounts } from '@/lib/accounts/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Users and orgs | MRM Admin', robots: { index: false } };

const field = 'h-9 w-80 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring';

/** Users and organisations (PLAN §9, superadmin): search, then open an organisation for its read-only summary, suspension and reinstatement. */
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdminArea('superadmin', '/admin/accounts');
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const result = q ? await searchAccounts(getDb(), admin, q) : null;

  return (
    <Page width="wide">
      <PageHeader title="Users and orgs">Find a person by email, phone or name, or an organisation by name.</PageHeader>
      <form action="/admin/accounts" className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="q" className="text-[13px] font-semibold text-muted-foreground">
            Search
          </label>
          <input id="q" name="q" defaultValue={q} maxLength={100} className={field} />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {q.length > 0 && q.length < MIN_SEARCH_LENGTH && <p className="text-sm text-muted-foreground">Type at least {MIN_SEARCH_LENGTH} characters.</p>}
      {result && (
        <>
          <section className="grid gap-3">
            <h2 className="text-base font-semibold">Organisations</h2>
            {result.orgs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organisation matches.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Kind</Th>
                    <Th>Members</Th>
                    <Th>Standing</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.orgs.map((o) => (
                    <tr key={o.id}>
                      <Td>
                        <Link href={`/admin/accounts/org/${o.id}`} className="font-semibold underline underline-offset-4">
                          {o.displayName}
                        </Link>
                        {o.legalName !== o.displayName && <div className="text-[13px] text-muted-foreground">{o.legalName}</div>}
                      </Td>
                      <Td className="capitalize">{o.kind}</Td>
                      <Td>{o.members}</Td>
                      <Td>{o.suspendedAt ? <StatusLabel tone="blocked">Suspended</StatusLabel> : <StatusLabel tone="ok">Active</StatusLabel>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
          <section className="grid gap-3">
            <h2 className="text-base font-semibold">People</h2>
            {result.users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No person matches.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Person</Th>
                    <Th>Contact</Th>
                    <Th>Organisations</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.users.map((u) => (
                    <tr key={u.id} className="align-top">
                      <Td>
                        {u.name ?? <span className="text-muted-foreground">No name</span>}
                        {u.platformRole === 'admin' && <div className="text-[12px] font-semibold text-muted-foreground">Admin</div>}
                      </Td>
                      <Td className="text-[13px]">
                        {u.email}
                        {u.phone && <div className="text-fg-2">{u.phone}</div>}
                      </Td>
                      <Td className="text-[13px]">
                        {u.orgs.length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          u.orgs.map((m) => (
                            <div key={m.orgId}>
                              <Link href={`/admin/accounts/org/${m.orgId}`} className="underline underline-offset-4">
                                {m.name}
                              </Link>{' '}
                              <span className="text-muted-foreground">({m.role})</span>
                            </div>
                          ))
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
