import { and, desc, eq } from 'drizzle-orm';
import { clearanceRequests, licenses } from '@/db/schema';
import { getMembershipRole } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import { AWAITING_SELLER, clearanceResponseSchema, type ClearanceStatus } from '../index';
import { describeTarget } from './providers';
import { finishRequest } from './workflow';

export type ClearanceActor = { userId: string; orgId: string };

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
  sentAt: Date | null;
  respondedAt: Date | null;
  sellerNote: string | null;
};

/** The org's clearance requests, open ones first. Members of the org can look; only the owner answers. */
export async function listSellerClearance(db: DbOrTx, actor: ClearanceActor, opts: { limit?: number } = {}): Promise<SellerClearanceRow[]> {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) throw new ClearanceInboxError('forbidden');
  const rows = await db
    .select({ r: clearanceRequests, trackTitle: licenses.trackTitle, licenseeName: licenses.licenseeName })
    .from(clearanceRequests)
    .innerJoin(licenses, eq(licenses.id, clearanceRequests.licenseId))
    .where(eq(clearanceRequests.sellerOrgId, actor.orgId))
    .orderBy(desc(clearanceRequests.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500));
  const out: SellerClearanceRow[] = [];
  for (const { r, trackTitle, licenseeName } of rows) {
    const status = r.status as ClearanceStatus;
    out.push({
      id: r.id,
      trackTitle,
      licenseeName,
      what: await describeTarget(db, r).catch(() => 'a registered use that is no longer on the license'),
      status,
      awaitingSeller: AWAITING_SELLER.includes(status),
      dueAt: r.dueAt,
      sentAt: r.sentAt,
      respondedAt: r.respondedAt,
      sellerNote: r.sellerNote,
    });
  }
  return out.sort((a, b) => Number(b.awaitingSeller) - Number(a.awaitingSeller)); // stable: open ones first, newest first within each
}

/**
 * The owner answers a request from the portal, like the emailed link does: released or declined, with a note.
 * The request must belong to the caller's org and still be waiting on the seller; the same transition and
 * notifications as the link run, and the audit row names the user.
 */
export async function respondAsSeller(
  db: DbOrTx,
  actor: ClearanceActor,
  requestId: string,
  raw: unknown,
  ip?: string | null,
): Promise<{ ok: true; outcome: 'released' | 'declined' } | { ok: false; reason: 'not_found' | 'not_awaiting' }> {
  if ((await getMembershipRole(db, actor.userId, actor.orgId)) !== 'owner') throw new ClearanceInboxError('forbidden');
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
