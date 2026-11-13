import { eq, sql } from 'drizzle-orm';
import { clearanceRequests } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';
import { AWAITING_SELLER, CLEARANCE_STATUSES, type ClearanceStatus } from '../index';
import { emailSeller } from './providers';
import { applyClearanceTransition, liveTarget } from './requests';
import { finishRequest, type FinishOutcome } from './workflow';

export type ClearanceQueueRow = {
  id: string;
  status: ClearanceStatus;
  scope: string;
  clearanceClass: string;
  seller: string;
  licensePublicId: string;
  trackTitle: string;
  target: string;
  dueAt: Date | null;
  sentAt: Date | null;
  createdAt: Date;
  lastError: string | null;
};

/** Clearance queue (PLAN §9): requests by status and age, oldest due first. Class A `not_required` rows are not work. */
export async function listClearanceQueue(db: DbOrTx, admin: AdminContext, filter: { status?: ClearanceStatus } = {}): Promise<ClearanceQueueRow[]> {
  requirePermission(admin, 'clearance');
  if (filter.status && !CLEARANCE_STATUSES.includes(filter.status)) throw new Error('unknown status');
  const rows = await db.execute<{
    id: string; status: ClearanceStatus; scope: string; class: string; seller: string; public_id: string; track_title: string;
    target: string; due_at: Date | null; sent_at: Date | null; created_at: Date; last_error: string | null;
  }>(sql`
    SELECT r.id, r.status, r.scope, r.clearance_class AS class, o.display_name AS seller, l.public_id, l.track_title,
           coalesce(c.platform || ' ' || c.handle_or_url, v.label) AS target, r.due_at, r.sent_at, r.created_at, r.last_error
    FROM clearance_requests r
    JOIN licenses l ON l.id = r.license_id
    JOIN organizations o ON o.id = r.seller_org_id
    LEFT JOIN licensed_channels c ON c.id = r.licensed_channel_id
    LEFT JOIN licensed_videos v ON v.id = r.licensed_video_id
    WHERE r.status <> 'not_required' AND ${liveTarget} ${filter.status ? sql`AND r.status = ${filter.status}` : sql``}
    ORDER BY coalesce(r.due_at, r.created_at) ASC LIMIT 200`);
  return rows.map((r) => ({
    id: r.id, status: r.status, scope: r.scope, clearanceClass: r.class, seller: r.seller, licensePublicId: r.public_id,
    trackTitle: r.track_title, target: r.target, dueAt: r.due_at && new Date(r.due_at), sentAt: r.sent_at && new Date(r.sent_at),
    createdAt: new Date(r.created_at), lastError: r.last_error,
  }));
}

/** overdue → escalated: ops takes the request over. */
export async function escalateClearance(db: DbOrTx, admin: AdminContext, requestId: string, ip?: string | null) {
  requirePermission(admin, 'clearance');
  return applyClearanceTransition(db, requestId, 'escalate', { actorUserId: admin.userId, ip });
}

/** An admin records the outcome on the seller's behalf (the seller told ops by phone or email), with a note as the evidence. */
export async function resolveClearance(
  db: DbOrTx,
  admin: AdminContext,
  requestId: string,
  input: { outcome: FinishOutcome; note: string },
  ip?: string | null,
) {
  requirePermission(admin, 'clearance');
  const note = input.note.trim();
  if (note.length < 3) throw new Error('A note recording the evidence is required');
  return db.transaction((tx) => finishRequest(tx, requestId, input.outcome, { actorUserId: admin.userId, note, via: 'admin', ip }));
}

/** Sends the seller a fresh response link (the old one stops working). */
export async function resendClearance(db: DbOrTx, admin: AdminContext, requestId: string, ip?: string | null): Promise<{ ok: boolean }> {
  requirePermission(admin, 'clearance');
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(clearanceRequests).where(eq(clearanceRequests.id, requestId)).for('update');
    if (!req || !AWAITING_SELLER.includes(req.status as ClearanceStatus)) return { ok: false };
    await emailSeller(tx, req, { dueNote: 'as soon as you can', reminder: true });
    await writeAudit(tx, { actorUserId: admin.userId, action: 'clearance.resend', entityType: 'clearance_request', entityId: requestId, after: { status: req.status }, ip });
    return { ok: true };
  });
}

export type SellerTurnaround = { completed: number; failed: number; awaiting: number; overdue: number; late: number; avgResponseHours: number | null };

/** Per-seller turnaround, for delisting decisions (PLAN §4.5). `late` counts answers that came after due_at. */
export async function sellerTurnaround(db: DbOrTx, admin: AdminContext, sellerOrgId: string): Promise<SellerTurnaround> {
  requirePermission(admin, 'clearance');
  const [r] = await db.execute<{ completed: number; failed: number; awaiting: number; overdue: number; late: number; avg_hours: number | null }>(sql`
    SELECT count(*) FILTER (WHERE status = 'completed')::int AS completed,
           count(*) FILTER (WHERE status = 'failed')::int AS failed,
           count(*) FILTER (WHERE status = 'sent')::int AS awaiting,
           count(*) FILTER (WHERE status IN ('overdue','escalated'))::int AS overdue,
           count(*) FILTER (WHERE responded_at > due_at)::int AS late,
           avg(extract(epoch FROM (responded_at - sent_at)) / 3600) FILTER (WHERE responded_at IS NOT NULL)::float8 AS avg_hours
    FROM clearance_requests WHERE seller_org_id = ${sellerOrgId} AND status <> 'not_required'`);
  return { completed: r!.completed, failed: r!.failed, awaiting: r!.awaiting, overdue: r!.overdue, late: r!.late, avgResponseHours: r!.avg_hours };
}
