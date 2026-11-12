import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import { getDb, type DbOrTx } from '@/lib/platform/db';
import type { AdminContext, AdminPermission, Guard, Session } from '../index';

/** Signed in with a confirmed email or phone. */
export function requireVerified(session: Session | null): Guard<Session> {
  if (!session) return { ok: false, reason: 'unauthenticated' };
  if (!session.verified) return { ok: false, reason: 'unverified' };
  return { ok: true, value: session };
}

/** Session was established with a TOTP factor. Used for payout-detail changes (checked on the session, not the UI). */
export function requireAal2(session: Session | null): Guard<Session> {
  const g = requireVerified(session);
  if (!g.ok) return g;
  return g.value.aal === 'aal2' ? g : { ok: false, reason: 'mfa_required' };
}

/**
 * Admin gate: verified session, platform_role = admin with the permission (superadmin has all),
 * and an AAL2 session. Role is read from the database on every call, never from the token.
 */
export async function requireAdmin(
  session: Session | null,
  permission: AdminPermission,
  db: DbOrTx = getDb(),
): Promise<Guard<AdminContext>> {
  const g = requireVerified(session);
  if (!g.ok) return g;
  const [row] = await db
    .select({ role: users.platformRole, perms: users.adminPermissions })
    .from(users)
    .where(eq(users.id, g.value.userId));
  const perms = (row?.perms ?? []) as AdminPermission[];
  if (row?.role !== 'admin' || !(perms.includes('superadmin') || perms.includes(permission))) {
    return { ok: false, reason: 'forbidden' };
  }
  if (g.value.aal !== 'aal2') return { ok: false, reason: 'mfa_required' };
  return { ok: true, value: { userId: g.value.userId, permissions: perms } };
}
