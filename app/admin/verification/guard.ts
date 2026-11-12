import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { loadSession, requireAdmin, type AdminContext } from '@/lib/identity/server';

/** Page/action gate for the verification admin area: signed in, admin with `verification`, session at AAL2. */
export async function requireVerificationAdmin(returnTo: string): Promise<AdminContext> {
  const guard = await requireAdmin(await loadSession(), 'verification');
  if (guard.ok) return guard.value;
  if (guard.reason === 'forbidden') notFound(); // do not reveal that the area exists
  if (guard.reason === 'mfa_required') redirect(`/auth/mfa?${new URLSearchParams({ next: returnTo })}`);
  redirect(`/auth/sign-in?${new URLSearchParams({ next: returnTo })}`);
}
