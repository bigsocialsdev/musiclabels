import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { loadSession, requireAdmin, requireAnyAdmin, type AdminContext, type AdminPermission } from '@/lib/identity/server';

type Denied = 'unauthenticated' | 'unverified' | 'forbidden' | 'mfa_required';
function deny(reason: Denied, returnTo: string): never {
  if (reason === 'forbidden') notFound(); // do not reveal that the area exists
  if (reason === 'mfa_required') redirect(`/auth/mfa?${new URLSearchParams({ next: returnTo })}`);
  redirect(`/auth/sign-in?${new URLSearchParams({ next: returnTo })}`);
}

/** Page/action gate for every admin area: signed in, admin with the area's permission, session at AAL2. */
export async function requireAdminArea(permission: AdminPermission, returnTo: string): Promise<AdminContext> {
  const guard = await requireAdmin(await loadSession(), permission);
  return guard.ok ? guard.value : deny(guard.reason, returnTo);
}

/** Gate for the areas PLAN §9 opens to "any admin" (enquiries): an admin with at least one permission, at AAL2. */
export async function requireAnyAdminArea(returnTo: string): Promise<AdminContext> {
  const guard = await requireAnyAdmin(await loadSession());
  return guard.ok ? guard.value : deny(guard.reason, returnTo);
}
