import { and, desc, eq, gte, like, lt, sql } from 'drizzle-orm';
import { auditLog, users } from '@/db/schema';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';

export type AuditFilter = {
  /** Exact action (`track.approve`) or a prefix ending in a dot (`track.`). */
  action?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
  /** Keyset cursor from the previous page: `<iso time>|<id>`. */
  cursor?: string;
};

export const AUDIT_PAGE_SIZE = 100;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function parseCursor(cursor: string | undefined): { at: Date; id: string } | null {
  const [iso, id] = (cursor ?? '').split('|');
  const at = new Date(iso ?? '');
  return id && !Number.isNaN(at.getTime()) && /^[0-9a-f-]{36}$/.test(id) ? { at, id } : null;
}

/** The audit log, newest first, for superadmin (PLAN §9). Read-only: the table is append-only and nothing here writes it. */
export async function listAuditLog(db: DbOrTx, admin: AdminContext, filter: AuditFilter = {}) {
  requirePermission(admin, 'superadmin');
  const cursor = parseCursor(filter.cursor);
  const where = and(
    filter.action ? (filter.action.endsWith('.') ? like(auditLog.action, `${escapeLike(filter.action)}%`) : eq(auditLog.action, filter.action)) : undefined,
    filter.entityType ? eq(auditLog.entityType, filter.entityType) : undefined,
    filter.entityId ? eq(auditLog.entityId, filter.entityId) : undefined,
    filter.actorUserId ? eq(auditLog.actorUserId, filter.actorUserId) : undefined,
    filter.from ? gte(auditLog.at, filter.from) : undefined,
    filter.to ? lt(auditLog.at, filter.to) : undefined,
    cursor ? sql`(${auditLog.at}, ${auditLog.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined,
  );
  const rows = await db
    .select({ entry: auditLog, actorEmail: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(where)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(AUDIT_PAGE_SIZE + 1);
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1)?.entry;
  return {
    rows: page.map((r) => ({ ...r.entry, actorEmail: r.actorEmail })),
    nextCursor: rows.length > AUDIT_PAGE_SIZE && last ? `${last.at.toISOString()}|${last.id}` : null,
  };
}
