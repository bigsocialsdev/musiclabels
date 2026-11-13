import { afterAll, beforeEach, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { outbox } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { enqueueEmail, enqueueOpsAlert, listOpsAlerts, processOutbox, type EmailSender } from './server';

afterAll(closeDb);

// Only this file's rows may be pending while it runs (test files run serially).
beforeEach(async () => {
  await getDb().execute(sql`DELETE FROM outbox`);
});

function fakeSender(opts: { fail?: boolean } = {}) {
  const sent: { to: string; idempotencyKey: string }[] = [];
  const sender: EmailSender = {
    async send(m) {
      await new Promise((r) => setTimeout(r, 20));
      if (opts.fail) throw new Error('provider down');
      sent.push({ to: m.to, idempotencyKey: m.idempotencyKey });
    },
  };
  return { sender, sent };
}

const msg = { kind: 'test', to: 'a@example.com', template: 'system_alert', payload: { title: 'T', message: 'M' } };

it('after() run and the sweep racing send a row exactly once', async () => {
  const db = getDb();
  const id = await enqueueEmail(db, msg);
  const { sender, sent } = fakeSender();

  const counts = await Promise.all([processOutbox({ id }, sender), processOutbox({}, sender), processOutbox({}, sender)]);

  expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  expect(sent).toEqual([{ to: 'a@example.com', idempotencyKey: id }]);
  const [row] = await db.select().from(outbox).where(eq(outbox.id, id));
  expect(row).toMatchObject({ status: 'sent', attempts: 1 });
  expect(await processOutbox({}, sender)).toBe(0); // nothing left
});

it('is written in the caller transaction (rolled back with it)', async () => {
  const db = getDb();
  await expect(
    db.transaction(async (tx) => {
      await enqueueEmail(tx, msg);
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');
  expect(await db.select().from(outbox)).toHaveLength(0);
});

it('retries a failing send, then gives up as failed after 5 attempts', async () => {
  const db = getDb();
  const id = await enqueueEmail(db, msg);
  const { sender } = fakeSender({ fail: true });
  for (let i = 0; i < 5; i++) await processOutbox({ id }, sender);
  const [row] = await db.select().from(outbox).where(eq(outbox.id, id));
  expect(row).toMatchObject({ status: 'failed', attempts: 5, lastError: 'provider down' });
  expect(await processOutbox({ id }, sender)).toBe(0);
});

it('reclaims a row stuck in sending after a crash', async () => {
  const db = getDb();
  const id = await enqueueEmail(db, msg);
  await db.execute(sql`UPDATE outbox SET status = 'sending', claimed_at = now() - interval '11 minutes' WHERE id = ${id}`);
  const { sender, sent } = fakeSender();
  expect(await processOutbox({}, sender)).toBe(1);
  expect(sent).toHaveLength(1);
});

it('lists ops alerts newest first with their delivery status, for any admin and nobody else', async () => {
  const db = getDb();
  await enqueueOpsAlert(db, 'first_kind', 'First problem', { orderId: 'o1' });
  await enqueueOpsAlert(db, 'second_kind', 'Second problem', { orderId: 'o2' });
  await enqueueEmail(db, { kind: 'license.issued', to: 'buyer@example.com', template: 'system_alert', payload: { title: 'not an alert', message: '' } });
  await db.update(outbox).set({ status: 'failed', lastError: 'provider down' }).where(sql`payload->>'title' = 'Second problem'`);
  const rows = await listOpsAlerts(db, { userId: '00000000-0000-7000-8000-000000000001', permissions: ['disputes'] });
  expect(rows.map((r) => [r.kind, r.title, r.emailStatus])).toEqual([
    ['second_kind', 'Second problem', 'failed'],
    ['first_kind', 'First problem', 'pending'],
  ]);
  expect(rows[0]).toMatchObject({ details: '{"orderId":"o2"}', lastError: 'provider down' });
  await expect(listOpsAlerts(db, { userId: '00000000-0000-7000-8000-000000000001', permissions: [] })).rejects.toThrow(/Admins only/);
});
