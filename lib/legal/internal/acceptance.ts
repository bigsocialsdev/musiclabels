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

/**
 * Accepts every currently pending document of the given kinds in one transaction, re-reading what is
 * pending at that moment so only current versions are recorded. Returns the gate result afterwards.
 */
export async function acceptPending(
  db: DbOrTx,
  input: { userId: string; kinds: readonly LegalKind[]; orgId?: string | null; ip?: string | null; userAgent?: string | null },
): Promise<AcceptanceCheck> {
  return db.transaction(async (tx) => {
    const now = await checkAcceptance(tx, input.userId, input.kinds);
    if (!now.ok) {
      for (const d of now.pending) {
        await recordAcceptance(tx, { userId: input.userId, orgId: input.orgId, documentId: d.id, ip: input.ip, userAgent: input.userAgent });
      }
    }
    return checkAcceptance(tx, input.userId, input.kinds);
  });
}

/** Has this organisation (acting through any member) accepted the CURRENT version of a document kind? */
export async function hasOrgAccepted(db: DbOrTx, orgId: string, kind: LegalKind, at = new Date()): Promise<boolean> {
  const doc = await getCurrentDocument(db, kind, at);
  if (!doc) return false;
  const [hit] = await db
    .select({ id: acceptances.id })
    .from(acceptances)
    .where(and(eq(acceptances.orgId, orgId), eq(acceptances.legalDocumentId, doc.id)))
    .limit(1);
  return Boolean(hit);
}
