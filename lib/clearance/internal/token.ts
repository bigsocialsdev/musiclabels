import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { clearanceRequests } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';

/** The response link stays valid this long; the overdue reminder and an admin resend issue a fresh one. */
export const RESPONSE_TOKEN_TTL_DAYS = 14;

export const newResponseToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Replaces the request's response token (so at most one is live) and returns the plaintext, which goes only
 * into the email. Only the hash is stored.
 */
export async function issueResponseToken(tx: DbOrTx, requestId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newResponseToken();
  const [row] = await tx
    .update(clearanceRequests)
    .set({ respondTokenHash: hashToken(token), tokenExpiresAt: sql`now() + make_interval(days => ${RESPONSE_TOKEN_TTL_DAYS})`, updatedAt: new Date() })
    .where(eq(clearanceRequests.id, requestId))
    .returning({ expiresAt: clearanceRequests.tokenExpiresAt });
  return { token, expiresAt: row!.expiresAt! };
}

