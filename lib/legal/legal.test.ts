import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { acceptances, auditLog, legalDocuments } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeUser } from '@/tests/factories';
import { LEGAL_KINDS, checkAcceptance, getCurrentDocument, publishLegalDocument, recordAcceptance } from './server';

afterAll(closeDb);
const db = getDb();

const superadmin = async () => {
  const s = await makeUser(db, { admin: ['superadmin'], aal: 'aal2' });
  return { userId: s.userId, permissions: ['superadmin'] as const };
};

const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};

describe('legal documents', () => {
  it('publishes consecutive immutable versions with a sha256 and an audit row', async () => {
    const admin = await superadmin();
    const a = await publishLegalDocument(db, admin, { kind: 'privacy', bodyMarkdown: 'v-a' });
    const b = await publishLegalDocument(db, admin, { kind: 'privacy', bodyMarkdown: 'v-b' });
    expect(b.version).toBe(a.version + 1);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, a.id), eq(auditLog.action, 'legal_document.publish')));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorUserId).toBe(admin.userId);
    expect(await dbMessage(sql`UPDATE legal_documents SET body_markdown = 'x' WHERE id = ${a.id}`)).toMatch(/append-only/);
  });

  it('is superadmin-only', async () => {
    const s = await makeUser(db, { admin: ['finance'], aal: 'aal2' });
    await expect(
      publishLegalDocument(db, { userId: s.userId, permissions: ['finance'] }, { kind: 'tos', bodyMarkdown: 'x' }),
    ).rejects.toThrow(/superadmin/);
  });

  it('assigns unique versions under concurrent publishes', async () => {
    const admin = await superadmin();
    const docs = await Promise.all(
      Array.from({ length: 4 }, (_, i) => publishLegalDocument(db, admin, { kind: 'seller_agreement', bodyMarkdown: `c${i}` })),
    );
    expect(new Set(docs.map((d) => d.version)).size).toBe(4);
  });

  it('only treats a version as current once its effective_at has passed', async () => {
    const admin = await superadmin();
    const now = await publishLegalDocument(db, admin, { kind: 'release_commitment', bodyMarkdown: 'now' });
    const future = await publishLegalDocument(db, admin, {
      kind: 'release_commitment',
      bodyMarkdown: 'later',
      effectiveAt: new Date(Date.now() + 86_400_000),
    });
    expect((await getCurrentDocument(db, 'release_commitment'))?.id).toBe(now.id);
    expect((await getCurrentDocument(db, 'release_commitment', new Date(Date.now() + 2 * 86_400_000)))?.id).toBe(future.id);
  });

  it('the kind constant matches the database CHECK', async () => {
    const admin = await superadmin();
    for (const kind of LEGAL_KINDS) {
      await expect(publishLegalDocument(db, admin, { kind, bodyMarkdown: 'k' })).resolves.toBeTruthy();
    }
    await expect(
      db.insert(legalDocuments).values({ kind: 'bogus', version: 1, bodyMarkdown: 'x', sha256: 'x', effectiveAt: new Date() }),
    ).rejects.toThrow();
  });
});

describe('acceptance gate', () => {
  it('blocks until the current ToS is accepted, records version/ip/time, and re-gates on a new version', async () => {
    const admin = await superadmin();
    const user = await makeUser(db);
    const v1 = await publishLegalDocument(db, admin, { kind: 'tos', bodyMarkdown: 'tos 1' });

    expect(await checkAcceptance(db, user.userId, ['tos'])).toMatchObject({ ok: false, pending: [{ id: v1.id }] });

    await recordAcceptance(db, { userId: user.userId, documentId: v1.id, ip: '203.0.113.9', userAgent: 'vitest' });
    expect(await checkAcceptance(db, user.userId, ['tos'])).toEqual({ ok: true });

    const [row] = await db.select().from(acceptances).where(eq(acceptances.userId, user.userId));
    expect(row).toMatchObject({ legalDocumentId: v1.id, ip: '203.0.113.9', userAgent: 'vitest' });
    expect(row!.acceptedAt).toBeInstanceOf(Date);

    const v2 = await publishLegalDocument(db, admin, { kind: 'tos', bodyMarkdown: 'tos 2' });
    expect(await checkAcceptance(db, user.userId, ['tos'])).toMatchObject({ ok: false, pending: [{ id: v2.id }] });
    await recordAcceptance(db, { userId: user.userId, documentId: v2.id });
    expect(await checkAcceptance(db, user.userId, ['tos'])).toEqual({ ok: true });
  });

  it('accepting the same version twice is a no-op and acceptances are append-only', async () => {
    const admin = await superadmin();
    const user = await makeUser(db);
    const d = await publishLegalDocument(db, admin, { kind: 'privacy', bodyMarkdown: 'dup' });
    await recordAcceptance(db, { userId: user.userId, documentId: d.id });
    await recordAcceptance(db, { userId: user.userId, documentId: d.id });
    expect(await db.select().from(acceptances).where(eq(acceptances.userId, user.userId))).toHaveLength(1);
    expect(await dbMessage(sql`DELETE FROM acceptances WHERE user_id = ${user.userId}`)).toMatch(/append-only/);
  });

  it('fails closed when a required kind has no current document', async () => {
    const user = await makeUser(db);
    // Evaluated at a time before anything was published: no document is in force, so the gate stays shut.
    const res = await checkAcceptance(db, user.userId, ['tos', 'privacy'], new Date('2000-01-01'));
    expect(res).toEqual({ ok: false, pending: [], noDocument: ['tos', 'privacy'] });
  });
});
