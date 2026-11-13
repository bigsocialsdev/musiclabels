import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { clearanceRequests, licenses } from '@/db/schema';
import { requireOrgMember, type OrgActor } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import { AWAITING_SELLER, clearanceResponseSchema, type ClearanceStatus } from '../index';
import { describeTarget } from './providers';
import { finishRequest } from './workflow';

export class ClearanceInboxError extends Error {}

export type SellerClearanceRow = {
  id: string;
  trackTitle: string;
  licenseeName: string;
  /** The channel or video the buyer registered, in words. */
  what: string;
  status: ClearanceStatus;
  /** True while the seller can still answer. */
  awaitingSeller: boolean;
  dueAt: Date | null;
  respondedAt: Date | null;
  sellerNote: string | null;
};

/** The org's clearance requests, open ones first. Members of the org can look; only the owner answers. */
export async function listSellerClearance(db: DbOrTx, actor: OrgActor, opts: { limit?: number } = {}): Promise<SellerClearanceRow[]> {
  await requireOrgMember(db, actor);
  const rows = await db
    .select({ r: clearanceRequests, trackTitle: licenses.trackTitle, licenseeName: licenses.licenseeName })
    .from(clearanceRequests)
    .innerJoin(licenses, eq(licenses.id, clearanceRequests.licenseId))
    .where(eq(clearanceRequests.sellerOrgId, actor.orgId))
    // Open ones first, ordered in SQL so the limit can never cut off an open request behind newer answered ones.
    .orderBy(sql`case when ${inArray(clearanceRequests.status, [...AWAITING_SELLER])} then 0 else 1 end`, desc(clearanceRequests.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
  return Promise.all(
    rows.map(async ({ r, trackTitle, licenseeName }): Promise<SellerClearanceRow> => {
      const status = r.status as ClearanceStatus;
      return {
        id: r.id,
        trackTitle,
        licenseeName,
        what: await describeTarget(db, r).catch(() => 'a registered use that is no longer on the license'),
        status,
        awaitingSeller: AWAITING_SELLER.includes(status),
        dueAt: r.dueAt,
        respondedAt: r.respondedAt,
        sellerNote: r.sellerNote,
      };
    }),
  );
}

/**
 * The owner answers a request from the portal, like the emailed link does: released or declined, with a note.
 * The request must belong to the caller's org and still be waiting on the seller; the same transition and
 * notifications as the link run, and the audit row names the user.
 */
export async function respondAsSeller(
  db: DbOrTx,
  actor: OrgActor,
  requestId: string,
  raw: unknown,
  ip?: string | null,
): Promise<{ ok: true; outcome: 'released' | 'declined' } | { ok: false; reason: 'not_found' | 'not_awaiting' }> {
  if ((await requireOrgMember(db, actor)) !== 'owner') throw new ClearanceInboxError('forbidden');
  const input = clearanceResponseSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select({ status: clearanceRequests.status })
      .from(clearanceRequests)
      .where(and(eq(clearanceRequests.id, requestId), eq(clearanceRequests.sellerOrgId, actor.orgId)))
      .for('update');
    if (!req) return { ok: false, reason: 'not_found' } as const;
    if (!AWAITING_SELLER.includes(req.status as ClearanceStatus)) return { ok: false, reason: 'not_awaiting' } as const;
    const done = await finishRequest(tx, requestId, input.outcome, { actorUserId: actor.userId, note: input.note || null, via: 'seller_portal', ip });
    return done.ok ? ({ ok: true, outcome: input.outcome } as const) : ({ ok: false, reason: 'not_awaiting' } as const);
  });
}
