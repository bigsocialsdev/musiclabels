import { afterAll, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { outbox } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { runCron } from './run';

afterAll(closeDb);
const db = getDb();
const authed = () => new Request('http://x/api/cron/y', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
const cronAlerts = async () => (await db.select().from(outbox).where(eq(outbox.kind, 'alert.cron_failure'))).length;

it('rejects a request without the cron secret and runs nothing', async () => {
  let ran = false;
  const res = await runCron(new Request('http://x/api/cron/y'), 'run-test-denied', { part: async () => (ran = true) });
  expect(res.status).toBe(401);
  expect(ran).toBe(false);
});

it('returns every part result with 200 and raises no alert when all parts succeed', async () => {
  const before = await cronAlerts();
  const res = await runCron(authed(), 'run-test-ok', { a: async () => 1, b: async () => ({ n: 2 }) });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ a: 1, b: { n: 2 } });
  expect(await cronAlerts()).toBe(before);
});

it('a different failure of the same cron on the same day still raises its own alert', async () => {
  const name = `run-test-two-${Date.now()}`;
  const before = await cronAlerts();
  const fails = (part: string) => ({ [part]: async () => { throw new Error(part); } });
  await runCron(authed(), name, fails('first'));
  await runCron(authed(), name, fails('second'));
  await runCron(authed(), name, fails('second'));
  expect(await cronAlerts()).toBe(before + 2);
});

it('a failing part does not stop the later parts, answers 500, and alerts ops once per cron per day', async () => {
  const name = `run-test-fail-${Date.now()}`;
  const before = await cronAlerts();
  let later = false;
  const parts = {
    broken: async () => {
      throw new Error('boom');
    },
    later: async () => (later = true),
  };
  const res = await runCron(authed(), name, parts);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ broken: { error: 'boom' }, later: true });
  expect(later).toBe(true);
  expect(await cronAlerts()).toBe(before + 1);
  const mine = (await db.select().from(outbox).where(eq(outbox.kind, 'alert.cron_failure'))).filter((r) => JSON.stringify(r.payload).includes(name));
  expect(mine[0]!.payload).toMatchObject({ title: `Cron job ${name} failed` });
  expect((await runCron(authed(), name, parts)).status).toBe(500); // still a failed run, but the alert is capped at one a day
  expect(await cronAlerts()).toBe(before + 1);
});
