import 'server-only';
import { redirect } from 'next/navigation';
import { loadSession, requireVerified, type Session } from '@/lib/identity/server';

/** Page/action gate for buyer pages: a verified session, else sign-in and come back. */
export async function requireBuyerSession(returnTo: string): Promise<Session> {
  const guard = requireVerified(await loadSession());
  if (!guard.ok) redirect(`/auth/sign-in?${new URLSearchParams({ next: returnTo })}`);
  return guard.value;
}
