import { and, asc, eq } from 'drizzle-orm';
import { copyrightComplaints } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { getTrackFacts, setTrackAvailability } from '@/lib/catalog/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import { listActiveLicensesForTrack } from '@/lib/licensing/server';
import { enqueueEmail, enqueueOpsAlert } from '@/lib/notifications/server';
import { allowPublicSubmission } from '@/lib/platform/ratelimit';
import type { DbOrTx } from '@/lib/platform/db';
import { COMPLAINT_STATUSES, complaintInputSchema, type ComplaintInput, type ComplaintStatus } from '../index';

/**
 * Public intake of a third-party copyright complaint (PLAN §5.5). No account needed, so it is rate limited here by
 * address and by the acknowledged email (the form's server action passes the client IP). Writes the row, the acknowledgement email to the complainant and an alert
 * to the grievance officer's inbox in one transaction. Timelines follow the grievance policy [Lawyer].
 */
export async function submitCopyrightComplaint(db: DbOrTx, raw: ComplaintInput, opts: { ip: string | null }): Promise<{ ok: true; reference: string } | { ok: false; issues: string[] }> {
  const input = complaintInputSchema.safeParse(raw);
  if (!input.success) return { ok: false, issues: input.error.issues.map((i) => i.path.join('.') || 'input') };
  if (!(await allowPublicSubmission('complaint', opts.ip, input.data.complainantEmail))) return { ok: false, issues: ['rate_limited'] };
  const { trackId, ...rest } = input.data;
  if (trackId && !(await getTrackFacts(db, trackId))) return { ok: false, issues: ['trackId'] };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(copyrightComplaints)
      .values({ ...rest, trackId: trackId ?? null, acknowledgedAt: new Date() })
      .returning({ id: copyrightComplaints.id });
    await enqueueEmail(tx, { kind: 'complaint.ack', to: rest.complainantEmail, template: 'complaint_ack', payload: { reference: row!.id } });
    await enqueueOpsAlert(tx, 'copyright_complaint', 'New third-party copyright complaint', { complaintId: row!.id, trackId: trackId ?? null });
    return { ok: true as const, reference: row!.id };
  });
}

export async function listComplaints(db: DbOrTx, admin: AdminContext, status?: ComplaintStatus) {
  requirePermission(admin, 'disputes');
  if (status && !COMPLAINT_STATUSES.includes(status)) throw new Error('unknown status');
  return db.select().from(copyrightComplaints).where(status ? eq(copyrightComplaints.status, status) : undefined).orderBy(asc(copyrightComplaints.receivedAt)).limit(500);
}

/** received → investigating; the admin who takes it becomes the grievance officer for it. */
export async function startInvestigation(db: DbOrTx, admin: AdminContext, complaintId: string, ip?: string | null) {
  requirePermission(admin, 'disputes');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(copyrightComplaints)
      .set({ status: 'investigating', grievanceOfficerId: admin.userId })
      .where(and(eq(copyrightComplaints.id, complaintId), eq(copyrightComplaints.status, 'received')))
      .returning({ id: copyrightComplaints.id });
    if (!row) return { ok: false as const };
    await writeAudit(tx, { actorUserId: admin.userId, action: 'complaint.investigate', entityType: 'copyright_complaint', entityId: complaintId, before: { status: 'received' }, after: { status: 'investigating' }, ip });
    return { ok: true as const };
  });
}

/**
 * Closes a complaint. Upholding one that names a track suspends the track (PLAN §4.1: needs the `verification`
 * permission as well; existing licenses are never touched) and alerts ops with every active license of that track
 * for the revocation/refund review. Rejecting is allowed straight from `received` (obvious spam).
 */
export async function resolveComplaint(
  db: DbOrTx,
  admin: AdminContext,
  complaintId: string,
  input: { outcome: 'upheld' | 'rejected'; note: string },
  ip?: string | null,
) {
  requirePermission(admin, 'disputes');
  const note = input.note.trim();
  if (!note) throw new Error('An outcome note is required');
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(copyrightComplaints).where(eq(copyrightComplaints.id, complaintId)).for('update');
    if (!c) return { ok: false as const, reason: 'not_found' as const };
    const allowed = input.outcome === 'upheld' ? c.status === 'investigating' : c.status === 'investigating' || c.status === 'received';
    if (!allowed) return { ok: false as const, reason: 'invalid' as const, status: c.status };
    const suspends = input.outcome === 'upheld' && c.trackId;
    if (suspends) requirePermission(admin, 'verification');

    await tx
      .update(copyrightComplaints)
      .set({ status: input.outcome, outcomeNote: note, closedAt: new Date() })
      .where(and(eq(copyrightComplaints.id, complaintId), eq(copyrightComplaints.status, c.status)));
    await writeAudit(tx, { actorUserId: admin.userId, action: `complaint.${input.outcome}`, entityType: 'copyright_complaint', entityId: complaintId, before: { status: c.status }, after: { status: input.outcome, note }, ip });

    let suspended = false;
    if (suspends && c.trackId) {
      const moved = await setTrackAvailability(tx, admin, { trackId: c.trackId, action: 'suspend', reason: `copyright complaint ${complaintId} upheld` }, ip);
      suspended = moved.ok;
      const licenses = await listActiveLicensesForTrack(tx, c.trackId);
      await enqueueOpsAlert(tx, 'complaint_upheld', 'Copyright complaint upheld: review revocation or refund of the track\'s licenses', {
        complaintId,
        trackId: c.trackId,
        activeLicenses: licenses.length,
        publicIds: licenses.slice(0, 50).map((l) => l.publicId),
      });
    }
    await enqueueEmail(tx, {
      kind: 'complaint.outcome',
      to: c.complainantEmail,
      template: 'dispute_update',
      payload: { subject: 'Outcome of your copyright complaint', message: `Reference ${c.id}: your complaint was ${input.outcome === 'upheld' ? 'upheld' : 'not upheld'}. ${note}` },
    });
    return { ok: true as const, suspended };
  });
}
