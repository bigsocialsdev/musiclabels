import { createHash } from 'node:crypto';
import { and, desc, eq, lte, sql } from 'drizzle-orm';
import { legalDocuments } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { LegalDocument, LegalKind } from '../index';

export type NewLegalDocument = { kind: LegalKind; bodyMarkdown: string; effectiveAt?: Date };

const toDoc = (r: typeof legalDocuments.$inferSelect): LegalDocument => ({
  id: r.id,
  kind: r.kind as LegalKind,
  version: r.version,
  sha256: r.sha256,
  effectiveAt: r.effectiveAt,
  bodyMarkdown: r.bodyMarkdown,
});

/**
 * Publishes the next version of a document. Superadmin only; the audit row commits with it.
 * Documents are immutable: fixing a typo is a new version.
 */
export async function publishLegalDocument(db: DbOrTx, admin: AdminContext, input: NewLegalDocument, ip?: string | null) {
  requirePermission(admin, 'superadmin'); // a PermissionError, so the admin matrix can tell a refusal from a run
  return db.transaction(async (tx) => {
    // Serialise concurrent publishes of the same kind so version numbers stay consecutive
    // (FOR UPDATE alone would not lock when no version exists yet).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'legal_document:' + input.kind}))`);
    const [latest] = await tx
      .select({ version: legalDocuments.version })
      .from(legalDocuments)
      .where(eq(legalDocuments.kind, input.kind))
      .orderBy(desc(legalDocuments.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx
      .insert(legalDocuments)
      .values({
        kind: input.kind,
        version,
        bodyMarkdown: input.bodyMarkdown,
        sha256: createHash('sha256').update(input.bodyMarkdown).digest('hex'),
        effectiveAt: input.effectiveAt ?? new Date(),
      })
      .returning();
    await writeAudit(tx, {
      actorUserId: admin.userId,
      action: 'legal_document.publish',
      entityType: 'legal_document',
      entityId: row!.id,
      after: { kind: input.kind, version, sha256: row!.sha256 },
      ip,
    });
    return toDoc(row!);
  });
}

/** A specific version, e.g. the license text a license pinned. */
export async function getLegalDocument(db: DbOrTx, id: string): Promise<LegalDocument | null> {
  const [row] = await db.select().from(legalDocuments).where(eq(legalDocuments.id, id));
  return row ? toDoc(row) : null;
}

/** The version in force now: highest version of the kind whose effective_at has passed. */
export async function getCurrentDocument(db: DbOrTx, kind: LegalKind, at = new Date()): Promise<LegalDocument | null> {
  const [row] = await db
    .select()
    .from(legalDocuments)
    .where(and(eq(legalDocuments.kind, kind), lte(legalDocuments.effectiveAt, at)))
    .orderBy(desc(legalDocuments.version))
    .limit(1);
  return row ? toDoc(row) : null;
}
