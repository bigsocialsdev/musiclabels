import { and, asc, desc, eq } from 'drizzle-orm';
import { reconciliationItems } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';

export type ReconciliationStatus = 'open' | 'resolved';

/** Mismatches the daily reconciliation found (PLAN §5.7), open ones first. */
export async function listReconciliationItems(db: DbOrTx, admin: AdminContext, status?: ReconciliationStatus) {
  requirePermission(admin, 'finance');
  return db
    .select()
    .from(reconciliationItems)
    .where(status ? eq(reconciliationItems.status, status) : undefined)
    .orderBy(asc(reconciliationItems.status), desc(reconciliationItems.createdAt)) // 'open' sorts before 'resolved'
    .limit(500);
}

/** Closes an item with the note that says what was done about it. The row keeps its details; only status, resolver and note are set. */
export async function resolveReconciliationItem(db: DbOrTx, admin: AdminContext, itemId: string, note: string, ip?: string | null): Promise<{ ok: boolean }> {
  requirePermission(admin, 'finance');
  const clean = note.trim();
  if (!clean) throw new Error('A resolution note is required');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(reconciliationItems)
      .set({ status: 'resolved', resolvedBy: admin.userId, resolutionNote: clean })
      .where(and(eq(reconciliationItems.id, itemId), eq(reconciliationItems.status, 'open')))
      .returning({ id: reconciliationItems.id, kind: reconciliationItems.kind });
    if (!row) return { ok: false };
    await writeAudit(tx, { actorUserId: admin.userId, action: 'reconciliation.resolve', entityType: 'reconciliation_item', entityId: itemId, before: { status: 'open' }, after: { status: 'resolved', note: clean, kind: row.kind }, ip });
    return { ok: true };
  });
}
