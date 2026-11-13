import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { loadSession, requireAdmin, type AdminContext, type AdminPermission } from '@/lib/identity/server';

/** Page/action gate for every admin area: signed in, admin with the area's permission, session at AAL2. */
export async function requireAdminArea(permission: AdminPermission, returnTo: string): Promise<AdminContext> {
  const guard = await requireAdmin(await loadSession(), permission);
  if (guard.ok) return guard.value;
  if (guard.reason === 'forbidden') notFound(); // do not reveal that the area exists
  if (guard.reason === 'mfa_required') redirect(`/auth/mfa?${new URLSearchParams({ next: returnTo })}`);
  redirect(`/auth/sign-in?${new URLSearchParams({ next: returnTo })}`);
}
