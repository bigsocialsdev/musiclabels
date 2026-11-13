import { count, desc, eq } from 'drizzle-orm';
import { acceptances, legalDocuments } from '@/db/schema';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';

/** Every published version of every legal document with how many users accepted it (PLAN §9: Legal documents). Bodies are left out; they can be long. */
export async function listLegalDocuments(db: DbOrTx, admin: AdminContext) {
  requirePermission(admin, 'superadmin');
  return db
    .select({
      id: legalDocuments.id,
      kind: legalDocuments.kind,
      version: legalDocuments.version,
      sha256: legalDocuments.sha256,
      effectiveAt: legalDocuments.effectiveAt,
      createdAt: legalDocuments.createdAt,
      accepted: count(acceptances.id),
    })
    .from(legalDocuments)
    .leftJoin(acceptances, eq(acceptances.legalDocumentId, legalDocuments.id))
    .groupBy(legalDocuments.id)
    .orderBy(legalDocuments.kind, desc(legalDocuments.version));
}
