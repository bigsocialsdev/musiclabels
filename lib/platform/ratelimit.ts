import 'server-only';
import { sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from './db';
import { clientIp } from './request';

export type Limit = { capacity: number; refillPerSecond: number };

/** Public limits, one place so the numbers can be tuned together. Each is a burst (capacity) that refills per second. */
export const LIMITS = {
  /** Browse, search and track pages (full-text search and facet counts). A person clicking around stays well under it. */
  storefront: { capacity: 120, refillPerSecond: 2 },
  /** The sitemap queries the catalogue; crawlers read it rarely. */
  crawl: { capacity: 20, refillPerSecond: 20 / 60 },
  /** OAuth return and other sign-in hand-offs. */
  authReturn: { capacity: 30, refillPerSecond: 0.5 },
  /** Razorpay webhooks per address, checked before the signature. Far above real delivery rates; it caps floods only. */
  webhook: { capacity: 300, refillPerSecond: 5 },
  /** Signed upload links per signed-in user: a seller loading a catalogue stays under it. */
  upload: { capacity: 60, refillPerSecond: 1 / 60 },
} as const satisfies Record<string, Limit>;

/** One allowance of signed upload links per user, shared by every kind of upload. */
export const allowUpload = (userId: string, db: DbOrTx = getDb()) => consume(`upload:${userId}`, LIMITS.upload, db);

/** Per-client-address throttle for public routes and pages: true when the request may proceed. */
export function allowByIp(name: string, h: Pick<Headers, 'get'>, limit: Limit, db: DbOrTx = getDb()): Promise<boolean> {
  return consume(`${name}:${clientIp(h) ?? 'unknown'}`, limit, db);
}

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

/**
 * Throttle for public forms that send an acknowledgement email to an address the visitor typed (so they cannot be
 * used to mail a victim): 5 submissions an hour per client address and 2 per hour per target email. `ip` null
 * (no address header) shares one bucket.
 */
export async function allowPublicSubmission(form: string, ip: string | null, email: string, db: DbOrTx = getDb()): Promise<boolean> {
  const perHour = (n: number): Limit => ({ capacity: n, refillPerSecond: n / 3600 });
  const byIp = await consume(`${form}:ip:${ip ?? 'unknown'}`, perHour(5), db);
  const byEmail = await consume(`${form}:email:${email.toLowerCase()}`, perHour(2), db);
  return byIp && byEmail;
}
