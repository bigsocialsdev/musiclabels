import { users } from '@/db/schema';
import type { Db } from '@/lib/platform/db';
import { uuidv7 } from '@/lib/platform/ids';
import type { AdminPermission, Session } from '@/lib/identity';

/** Inserts a user row and returns a matching session. */
export async function makeUser(
  db: Db,
  opts: { admin?: AdminPermission[]; aal?: Session['aal']; verified?: boolean } = {},
): Promise<Session> {
  const id = uuidv7();
  const email = `${id}@example.com`;
  await db.insert(users).values({
    id,
    email,
    verifiedAt: new Date(),
    platformRole: opts.admin ? 'admin' : 'none',
    adminPermissions: opts.admin ?? [],
  });
  return { userId: id, email, phone: null, verified: opts.verified ?? true, aal: opts.aal ?? 'aal1' };
}
