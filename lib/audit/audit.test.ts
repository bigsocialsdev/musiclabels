import { afterAll, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { auditLog } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { writeAudit } from './server';

afterAll(closeDb);

const entry = { actorUserId: null, action: 'test.action', entityType: 'test', entityId: 'e1', after: { a: 1 } };

it('records an entry inside the caller transaction', async () => {
  const db = getDb();
  const entityId = `tx-${Date.now()}`;
  await db.transaction(async (tx) => writeAudit(tx, { ...entry, entityId }));
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.after).toEqual({ a: 1 });
});

it('rolls back with the transaction', async () => {
  const db = getDb();
  const entityId = `rb-${Date.now()}`;
  await expect(
    db.transaction(async (tx) => {
      await writeAudit(tx, { ...entry, entityId });
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(await db.select().from(auditLog).where(eq(auditLog.entityId, entityId))).toHaveLength(0);
});

it('rejects UPDATE, DELETE and TRUNCATE at the database', async () => {
  const db = getDb();
  await writeAudit(db, entry);
  // drizzle wraps driver errors; the database's message is on `cause`.
  const dbError = async (q: ReturnType<typeof sql>) => {
    const err = await db.execute(q).then(() => null, (e: Error) => e);
    return (err?.cause as Error | undefined)?.message ?? err?.message;
  };
  expect(await dbError(sql`UPDATE audit_log SET action = 'x'`)).toMatch(/append-only/);
  expect(await dbError(sql`DELETE FROM audit_log`)).toMatch(/append-only/);
  expect(await dbError(sql`TRUNCATE audit_log`)).toMatch(/append-only/);
});
