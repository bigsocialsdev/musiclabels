import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { listSellerOrgs, loadSession, requireVerified } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account suspended | MRM', robots: { index: false } };

/** Where a seller whose organisation an admin suspended lands; anyone else is sent back to the seller area. */
export default async function SuspendedPage() {
  const guard = requireVerified(await loadSession());
  if (!guard.ok) redirect(`/auth/sign-in?${new URLSearchParams({ next: '/seller/suspended' })}`);
  const orgs = await listSellerOrgs(getDb(), guard.value.userId);
  if (!orgs[0]?.suspendedAt) redirect('/seller/onboarding');
  return (
    <Page>
      <PageHeader title="Your seller account is suspended">While it is suspended your tracks are off sale and this account is closed to you.</PageHeader>
      <Notice tone="attention" role="status">
        Licenses already sold stay valid. If you think this is a mistake, contact the platform team and quote your organisation name, {orgs[0].displayName}.
      </Notice>
    </Page>
  );
}
