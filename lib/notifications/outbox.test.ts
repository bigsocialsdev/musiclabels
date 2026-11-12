import { afterAll, beforeEach, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { outbox } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { enqueueEmail, processOutbox, type EmailSender } from './server';

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
