import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from './db';

export type Limit = { capacity: number; refillPerSecond: number };

/**
 * Token bucket in one atomic upsert. Returns true if a token was taken, false if limited.
 * A first hit creates the bucket full minus one; later hits refill by elapsed time, capped at capacity.
 */
export async function consume(key: string, limit: Limit, db: DbOrTx = getDb()): Promise<boolean> {
  const { capacity, refillPerSecond } = limit;
  const rows = await db.execute(sql`
    INSERT INTO rate_limits (key, tokens, updated_at)
    VALUES (${key}, ${capacity - 1}, now())
    ON CONFLICT (key) DO UPDATE SET
      tokens = LEAST(${capacity}::float8, rate_limits.tokens
        + EXTRACT(EPOCH FROM (now() - rate_limits.updated_at)) * ${refillPerSecond}::float8) - 1,
      updated_at = now()
    WHERE LEAST(${capacity}::float8, rate_limits.tokens
        + EXTRACT(EPOCH FROM (now() - rate_limits.updated_at)) * ${refillPerSecond}::float8) >= 1
    RETURNING tokens`);
  return rows.length > 0;
}

/** Buckets idle for a day are full again for any sane limit; drop them. */
export async function cleanupRateLimits(db: DbOrTx = getDb()): Promise<number> {
  const rows = await db.execute(sql`DELETE FROM rate_limits WHERE updated_at < now() - interval '1 day' RETURNING key`);
  return rows.length;
}
