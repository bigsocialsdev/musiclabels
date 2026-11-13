import 'server-only';
import { redirect } from 'next/navigation';
import { ensureUser, listSellerOrgs, loadSession, requireVerified, type Session } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';

/**
 * Page/action gate for seller pages: a verified session (else sign-in and come back) and the seller org it acts
 * for. The org comes from the caller's own memberships, never from the request; `orgId` is null before onboarding.
 */
export async function requireSellerSession(returnTo: string): Promise<{ session: Session; orgId: string | null }> {
  const guard = requireVerified(await loadSession());
  if (!guard.ok) redirect(`/auth/sign-in?${new URLSearchParams({ next: returnTo })}`);
  const db = getDb();
  await ensureUser(db, guard.value); // memberships and acceptances reference users(id)
  const orgs = await listSellerOrgs(db, guard.value.userId);
  return { session: guard.value, orgId: orgs[0]?.id ?? null };
}
