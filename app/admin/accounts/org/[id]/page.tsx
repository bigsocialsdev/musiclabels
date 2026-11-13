import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDateTime, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { viewOrgSummary } from '@/lib/accounts/server';
import { formatInr } from '@/lib/invoicing';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../../../guard';
import { reinstateOrgAction, suspendOrgAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Organisation | MRM Admin', robots: { index: false } };

const ERRORS: Record<string, string> = {
  need_reason: 'Give a reason and tick the confirmation.',
  already_suspended: 'That organisation is already suspended.',
  not_suspended: 'That organisation is not suspended.',
  not_found: 'That organisation no longer exists.',
};

const textarea = 'w-full max-w-xl rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Read-only summary of one organisation (PLAN §9 "read-only impersonation"): what its members would see, with no session
 * swap and nothing changed on their behalf. Each load is logged to the audit log under the admin's name.
 */
export default async function OrgPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; error?: string; paused?: string; resumed?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const admin = await requireAdminArea('superadmin', `/admin/accounts/org/${id}`);
  const { done, error, paused, resumed } = await searchParams;
  const summary = await viewOrgSummary(getDb(), admin, id, clientIp(await headers()));
  if (!summary) notFound();
  const { org, members, seller, trackCounts, recentOrders, licenseCount } = summary;
  const suspendedAt = org.suspendedAt;
  const pausedCount = Number(paused) || 0;
  const resumedCount = Number(resumed) || 0;

  return (
    <Page width="wide">
      <Notice tone="info" role="status">
        <strong>Read-only view of {org.displayName}.</strong> You are looking at a summary, not signed in as them. Nothing here changes their account, and this view is logged under your name.
      </Notice>
      <PageHeader title={org.displayName}>
        <Link href="/admin/accounts" className="underline underline-offset-4">
          Back to search
        </Link>
      </PageHeader>
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      {done === 'suspended' && (
        <Notice tone="ok" role="status">
          Suspended. {pausedCount} published {plural(pausedCount, 'track was', 'tracks were')} taken off sale.
        </Notice>
      )}
      {done === 'reinstated' && (
        <Notice tone="ok" role="status">
          Reinstated. {resumedCount} {plural(resumedCount, 'track was', 'tracks were')} put back on sale.
        </Notice>
      )}

      <section className="grid gap-2 text-sm">
        <h2 className="text-base font-semibold">Standing</h2>
        <p className="flex flex-wrap items-center gap-2">
          <span className="capitalize">{org.kind} organisation</span>
          {suspendedAt ? <StatusLabel tone="blocked">Suspended {istDateTime(suspendedAt)}</StatusLabel> : <StatusLabel tone="ok">In good standing</StatusLabel>}
        </p>
        {suspendedAt && <p className="text-muted-foreground">Reason given: {org.suspensionReason}</p>}
        <p className="text-muted-foreground">
          Legal name {org.legalName}
          {org.gstin ? `, GSTIN ${org.gstin}` : ''}. Created {istDateTime(org.createdAt)}.
        </p>
        {seller && (
          <p className="text-muted-foreground">
            Seller: {seller.entityType}, {seller.onboardingMode.replace('_', ' ')}, KYC {seller.kycStatus}, account {seller.status}, PAN {seller.hasPan ? 'on file' : 'missing'},{' '}
            {seller.gstRegistered ? 'GST registered' : 'not GST registered'}
            {seller.opsContactEmail ? `, ops contact ${seller.opsContactEmail}` : ''}.
          </p>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Members</h2>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <Td>{m.name ?? <span className="text-muted-foreground">No name</span>}</Td>
                <Td className="text-[13px]">{m.email}</Td>
                <Td className="capitalize">{m.role}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {trackCounts.length > 0 && (
        <section className="grid gap-2 text-sm">
          <h2 className="text-base font-semibold">Tracks</h2>
          <p className="text-muted-foreground">{trackCounts.map((t) => `${t.n} ${t.status.replace('_', ' ')}`).join(', ')}.</p>
        </section>
      )}

      {(recentOrders.length > 0 || licenseCount > 0) && (
        <section className="grid gap-3">
          <h2 className="text-base font-semibold">Purchases</h2>
          <p className="text-sm text-muted-foreground">
            {licenseCount} {plural(licenseCount, 'license', 'licenses')} held. Latest orders:
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Placed</Th>
                <Th>Tier</Th>
                <Th>Status</Th>
                <Th>Total</Th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id}>
                  <Td className="whitespace-nowrap text-fg-2">{istDateTime(o.createdAt)}</Td>
                  <Td>{o.tier.replace('_', ' ')}</Td>
                  <Td>{o.status.replace('_', ' ')}</Td>
                  <Td>{formatInr(o.totalPaise)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <section className="grid max-w-xl gap-3">
        <h2 className="text-base font-semibold">{suspendedAt ? 'Reinstate' : 'Suspend'}</h2>
        <p className="text-sm text-muted-foreground">
          {suspendedAt
            ? 'Members get their access back. For a seller, the account becomes active and the tracks this suspension took off sale go back on sale; tracks suspended for another reason stay suspended.'
            : 'Members lose access to this organisation everywhere. For a seller, the account is suspended and its published tracks come off sale. Licenses already sold stay valid.'}
        </p>
        <form action={(suspendedAt ? reinstateOrgAction : suspendOrgAction).bind(null, org.id)} className="grid gap-3">
          <div className="grid gap-1">
            <label htmlFor="reason" className="text-[13px] font-semibold text-muted-foreground">
              Reason (kept in the audit log)
            </label>
            <textarea id="reason" name="reason" required maxLength={1000} rows={3} className={textarea} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" required className="mt-1" />
            <span>{suspendedAt ? 'Reinstate this organisation.' : 'Suspend this organisation and take its published tracks off sale.'}</span>
          </label>
          <div>
            <Button type="submit" variant={suspendedAt ? 'secondary' : 'destructive'}>
              {suspendedAt ? 'Reinstate' : 'Suspend'}
            </Button>
          </div>
        </form>
      </section>
    </Page>
  );
}
