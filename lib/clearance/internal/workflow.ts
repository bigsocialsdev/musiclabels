import { and, eq, inArray, sql } from 'drizzle-orm';
import { clearanceRequests } from '@/db/schema';
import { getTrackFacts } from '@/lib/catalog/server';
import { listOrgOwnerEmails } from '@/lib/identity/server';
import { getLicenseById } from '@/lib/licensing/server';
import { enqueueEmail, enqueueOpsAlert } from '@/lib/notifications/server';
import { addBusinessDays } from '@/lib/platform/business-days';
import type { DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { errorMessage, log } from '@/lib/platform/log';
import { AWAITING_SELLER, clearanceResponseSchema, type ClearanceStatus } from '../index';
import { describeTarget, emailSeller, providerById } from './providers';
import { applyClearanceTransition, ensureClearanceRequests, liveTarget, type ClearanceRow } from './requests';
import { hashToken } from './token';

const turnaroundDays = () => getEnv().CLEARANCE_TURNAROUND_BUSINESS_DAYS ?? 1;
const BATCH = 25;

/** Tells the license's purchasing org (its owners) how a clearance request stands. Written with the caller's transaction. */
async function notifyBuyer(tx: DbOrTx, req: ClearanceRow, kind: string, message: string): Promise<void> {
  const license = await getLicenseById(tx, req.licenseId);
  if (!license) return;
  const track = await getTrackFacts(tx, license.trackId);
  for (const to of await listOrgOwnerEmails(tx, license.purchaserOrgId)) {
    await enqueueEmail(tx, { kind, to, template: 'clearance_update', payload: { trackTitle: track?.title ?? license.trackTitle, message } });
  }
}

/**
 * pending → sent for requests waiting to go out (PLAN §4.5). The claim is `FOR UPDATE SKIP LOCKED`, the provider's
 * submit and the transition share one transaction, and a request that cannot be sent (no ops contact, a provider
 * error) stays pending with `last_error` for the next run. Safe to run concurrently and repeatedly.
 */
export async function dispatchClearance(db: DbOrTx, opts: { licenseId?: string; limit?: number } = {}): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT r.id FROM clearance_requests r JOIN licenses l ON l.id = r.license_id
    WHERE r.status = 'pending' AND l.status = 'active' AND ${liveTarget}
      ${opts.licenseId ? sql`AND r.license_id = ${opts.licenseId}` : sql``}
    ORDER BY r.created_at LIMIT ${opts.limit ?? BATCH}`);
  let sent = 0;
  for (const { id } of rows) if (await dispatchOne(db, id)) sent++;
  return sent;
}

async function dispatchOne(db: DbOrTx, id: string): Promise<boolean> {
  try {
    return await db.transaction(async (tx) => {
      const [req] = await tx.select().from(clearanceRequests).where(and(eq(clearanceRequests.id, id), eq(clearanceRequests.status, 'pending'))).for('update', { skipLocked: true });
      if (!req) return false;
      const dueAt = addBusinessDays(new Date(), turnaroundDays());
      const out = await providerById(req.provider).submit(req, { tx, dueAt });
      if (out.status !== 'sent') return false;
      const moved = await applyClearanceTransition(tx, id, 'send', { actorUserId: null, via: 'dispatch', set: { sentAt: new Date(), dueAt, externalRef: out.externalRef ?? null, lastError: null } });
      return moved.ok;
    });
  } catch (e) {
    log.error('clearance dispatch failed', { requestId: id, error: errorMessage(e) });
    await db.update(clearanceRequests).set({ lastError: errorMessage(e).slice(0, 500) }).where(and(eq(clearanceRequests.id, id), eq(clearanceRequests.status, 'pending')));
    return false;
  }
}

export type FinishOutcome = 'released' | 'declined';

/**
 * Closes a request that is waiting on the seller: complete (released) or fail (cannot release), clears the
 * response link, tells the buyer, and, when it failed, alerts ops because the refund path opens (PLAN §4.5; a
 * person decides the refund). Used by the seller's link and by an admin.
 */
export async function finishRequest(
  tx: DbOrTx,
  id: string,
  outcome: FinishOutcome,
  opts: { actorUserId: string | null; note?: string | null; via: string; ip?: string | null },
): Promise<{ ok: true } | { ok: false; status?: ClearanceStatus }> {
  const moved = await applyClearanceTransition(tx, id, outcome === 'released' ? 'complete' : 'fail', {
    actorUserId: opts.actorUserId,
    note: opts.note,
    via: opts.via,
    ip: opts.ip,
    set: { respondedAt: new Date(), sellerNote: opts.note ?? null, respondTokenHash: null, tokenExpiresAt: null },
  });
  if (!moved.ok) return { ok: false, status: moved.status };
  const [req] = await tx.select().from(clearanceRequests).where(eq(clearanceRequests.id, id));
  const what = await describeTarget(tx, req!).catch(() => 'a registered use');
  if (outcome === 'released') {
    await notifyBuyer(tx, req!, 'clearance.completed', `The seller has confirmed release for ${what}.`);
  } else {
    await notifyBuyer(tx, req!, 'clearance.failed', `The seller could not confirm release for ${what}. Our team will contact you about next steps.`);
    await enqueueOpsAlert(tx, 'clearance_failed', 'A seller declined or could not release a clearance request: review the license for a refund', { requestId: id, licenseId: req!.licenseId });
  }
  return { ok: true };
}

export type ResponseView = { requestId: string; trackTitle: string; what: string; licenseeName: string; dueAt: Date | null; status: ClearanceStatus };

/** Finds the request a response token belongs to: unexpired, not yet used, still awaiting the seller. The link's token is never logged or returned. */
async function findByToken(tx: DbOrTx, token: string, lock: boolean): Promise<ClearanceRow | null> {
  const q = tx
    .select()
    .from(clearanceRequests)
    .where(and(eq(clearanceRequests.respondTokenHash, hashToken(token)), inArray(clearanceRequests.status, [...AWAITING_SELLER]), sql`${clearanceRequests.tokenExpiresAt} > now()`));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

/** What the response page shows. Reading never consumes the token (mail scanners open links). */
export async function peekResponse(db: DbOrTx, token: string): Promise<ResponseView | null> {
  const req = await findByToken(db, token, false);
  if (!req) return null;
  const license = await getLicenseById(db, req.licenseId);
  if (!license) return null;
  const track = await getTrackFacts(db, license.trackId);
  return {
    requestId: req.id,
    trackTitle: track?.title ?? license.trackTitle,
    what: await describeTarget(db, req),
    licenseeName: license.licenseeName,
    dueAt: req.dueAt,
    status: req.status as ClearanceStatus,
  };
}

/**
 * The seller answers through the link. Single use: the request row is locked, the token hash is cleared by the
 * same transition that records the answer, so a second or concurrent use finds nothing. An unknown, expired or
 * used token is one indistinguishable `invalid`.
 */
export async function respondToClearance(db: DbOrTx, token: string, raw: unknown): Promise<{ ok: true; outcome: FinishOutcome } | { ok: false; reason: 'invalid' | 'bad_input' }> {
  const input = clearanceResponseSchema.safeParse(raw);
  if (!input.success) return { ok: false, reason: 'bad_input' };
  return db.transaction(async (tx) => {
    const req = await findByToken(tx, token, true);
    if (!req) return { ok: false, reason: 'invalid' } as const;
    const done = await finishRequest(tx, req.id, input.data.outcome, { actorUserId: null, note: input.data.note || null, via: 'seller_link' });
    return done.ok ? ({ ok: true, outcome: input.data.outcome } as const) : ({ ok: false, reason: 'invalid' } as const);
  });
}

/** sent → overdue once due_at has passed: a fresh link and reminder to the seller, a notice to the buyer and to ops. */
export async function markOverdue(db: DbOrTx, limit = BATCH): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT r.id FROM clearance_requests r
    WHERE r.status = 'sent' AND r.due_at < now() AND ${liveTarget}
    ORDER BY r.due_at LIMIT ${limit}`);
  let n = 0;
  for (const { id } of rows) {
    try {
      const done = await db.transaction(async (tx) => {
        const moved = await applyClearanceTransition(tx, id, 'mark_overdue', { actorUserId: null, via: 'sweep' });
        if (!moved.ok) return false;
        const [req] = await tx.select().from(clearanceRequests).where(eq(clearanceRequests.id, id));
        const what = await describeTarget(tx, req!);
        await emailSeller(tx, req!, { dueNote: 'now: the response is overdue', reminder: true });
        await notifyBuyer(tx, req!, 'clearance.overdue', `The seller has not yet confirmed release for ${what}. We have sent a reminder; do not publish there until it is confirmed.`);
        await enqueueOpsAlert(tx, 'clearance_overdue', 'A clearance request is overdue', { requestId: id, licenseId: req!.licenseId });
        return true;
      });
      if (done) n++;
    } catch (e) {
      log.error('clearance overdue failed', { requestId: id, error: errorMessage(e) });
    }
  }
  return n;
}

/** Licenses with a channel or video that has no clearance request (issued before this existed, or a crash): fill them in. */
export async function backfillClearance(db: DbOrTx, limit = 50): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT l.id FROM licenses l JOIN tracks t ON t.id = l.track_id
    WHERE l.status = 'active' AND t.clearance_class IN ('A','B') AND (
      EXISTS (SELECT 1 FROM licensed_channels c WHERE c.license_id = l.id AND c.removed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM clearance_requests r WHERE r.licensed_channel_id = c.id))
      OR EXISTS (SELECT 1 FROM licensed_videos v WHERE v.license_id = l.id
                 AND NOT EXISTS (SELECT 1 FROM clearance_requests r WHERE r.licensed_video_id = v.id)))
    LIMIT ${limit}`);
  let n = 0;
  for (const { id } of rows) n += await db.transaction((tx) => ensureClearanceRequests(tx, id));
  return n;
}
