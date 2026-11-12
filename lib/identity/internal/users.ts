import { sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import type { Session } from '../index';

/**
 * Creates or refreshes the application user row for a verified session (call after sign-in).
 * Never touches platform_role or admin_permissions: those are granted only by superadmins.
 */
export async function ensureUser(db: DbOrTx, session: Session): Promise<void> {
  if (!session.verified) throw new Error('Cannot create a user from an unverified session');
  await db
    .insert(users)
    .values({ id: session.userId, email: session.email, phone: session.phone, verifiedAt: new Date() })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: session.email,
        phone: session.phone,
        verifiedAt: sql`coalesce(${users.verifiedAt}, now())`,
      },
    });
}
