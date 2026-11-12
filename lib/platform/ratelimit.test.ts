import { afterAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from './db';
import { cleanupRateLimits, consume } from './ratelimit';

afterAll(closeDb);

it('allows up to capacity, then limits, atomically under concurrency', async () => {
  const key = `t-${Date.now()}`;
  const results = await Promise.all(
    Array.from({ length: 8 }, () => consume(key, { capacity: 3, refillPerSecond: 0 })),
  );
  expect(results.filter(Boolean)).toHaveLength(3);
});

it('refills over time', async () => {
  const db = getDb();
  const key = `refill-${Date.now()}`;
  const limit = { capacity: 2, refillPerSecond: 1 };
  expect(await consume(key, limit)).toBe(true);
  expect(await consume(key, limit)).toBe(true);
  expect(await consume(key, limit)).toBe(false);
  await db.execute(sql`UPDATE rate_limits SET updated_at = now() - interval '3 seconds' WHERE key = ${key}`);
  expect(await consume(key, limit)).toBe(true);
});

it('cleans up idle buckets', async () => {
  const db = getDb();
  const key = `old-${Date.now()}`;
  await consume(key, { capacity: 1, refillPerSecond: 0 });
  await db.execute(sql`UPDATE rate_limits SET updated_at = now() - interval '2 days' WHERE key = ${key}`);
  expect(await cleanupRateLimits()).toBeGreaterThanOrEqual(1);
});
