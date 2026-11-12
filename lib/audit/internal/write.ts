import { auditLog } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';

export type AuditEntry = {
  actorUserId: string | null; // null = system action
  impersonatedBy?: string | null;
  action: string; // e.g. 'track.approve'
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

/** Pass the caller's transaction so the audit row commits or rolls back with the change it records. */
export async function writeAudit(tx: DbOrTx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: e.actorUserId,
    impersonatedBy: e.impersonatedBy ?? null,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    before: e.before ?? null,
    after: e.after ?? null,
    ip: e.ip ?? null,
  });
}
