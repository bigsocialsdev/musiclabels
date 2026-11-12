import { and, eq } from 'drizzle-orm';
import { acceptances } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import type { AcceptanceCheck, LegalDocument, LegalKind } from '../index';
import { getCurrentDocument } from './documents';

export type AcceptInput = { userId: string; orgId?: string | null; documentId: string; ip?: string | null; userAgent?: string | null };

/** Records acceptance (append-only). Accepting the same version twice is a no-op. */
export async function recordAcceptance(db: DbOrTx, input: AcceptInput): Promise<void> {
  await db
    .insert(acceptances)
    .values({
      userId: input.userId,
      orgId: input.orgId ?? null,
      legalDocumentId: input.documentId,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    })
    .onConflictDoNothing();
}

/**
 * The acceptance gate: has this user accepted the CURRENT version of every required kind?
 * A new published version makes the user pending again (re-acceptance). Missing documents fail closed.
 */
export async function checkAcceptance(db: DbOrTx, userId: string, kinds: readonly LegalKind[], at = new Date()): Promise<AcceptanceCheck> {
  const pending: LegalDocument[] = [];
  const noDocument: LegalKind[] = [];
  for (const kind of kinds) {
    const doc = await getCurrentDocument(db, kind, at);
    if (!doc) {
      noDocument.push(kind);
      continue;
    }
    const [hit] = await db
      .select({ id: acceptances.id })
      .from(acceptances)
      .where(and(eq(acceptances.userId, userId), eq(acceptances.legalDocumentId, doc.id)));
    if (!hit) pending.push(doc);
  }
  return pending.length === 0 && noDocument.length === 0 ? { ok: true } : { ok: false, pending, noDocument };
}
