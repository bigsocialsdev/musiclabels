import { desc, like } from 'drizzle-orm';
import { outbox } from '@/db/schema';
import { PermissionError, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';
import { ALERT_KIND_PREFIX } from './outbox';

export const ALERT_LIST_LIMIT = 200;

/** The ops alerts raised so far, newest first, with whether the email to ops went out (PLAN §10 monitoring). Any admin. */
export async function listOpsAlerts(db: DbOrTx, admin: AdminContext) {
  if (admin.permissions.length === 0) throw new PermissionError('Admins only');
  const rows = await db
    .select({ id: outbox.id, kind: outbox.kind, payload: outbox.payload, status: outbox.status, lastError: outbox.lastError, createdAt: outbox.createdAt })
    .from(outbox)
    .where(like(outbox.kind, `${ALERT_KIND_PREFIX}%`))
    .orderBy(desc(outbox.createdAt))
    .limit(ALERT_LIST_LIMIT);
  return rows.map((r) => {
    const p = r.payload as { title?: unknown; message?: unknown };
    return {
      id: r.id,
      kind: r.kind.slice(ALERT_KIND_PREFIX.length),
      title: typeof p.title === 'string' ? p.title : '',
      details: typeof p.message === 'string' ? p.message : '',
      emailStatus: r.status as 'pending' | 'sending' | 'sent' | 'failed',
      lastError: r.lastError,
      createdAt: r.createdAt,
    };
  });
}
