import { asc, eq } from 'drizzle-orm';
import { enquiries } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { getSellableTrack } from '@/lib/catalog/server';
import type { AdminContext } from '@/lib/identity';
import { enqueueEmail, enqueueOpsAlert } from '@/lib/notifications/server';
import { allowPublicSubmission } from '@/lib/platform/ratelimit';
import type { DbOrTx } from '@/lib/platform/db';
import { ENQUIRY_STATUSES, ENQUIRY_TRANSITIONS, enquiryInputSchema, type EnquiryInput, type EnquiryStatus } from '../index';


/**
 * Commercial/Broadcast enquiry for a published track: a lead for the team, with no checkout and no license record
 * (PLAN §6.1). Rate limited here by address and by the acknowledged email; `orgId` is set only by a server action that has checked the signed-in
 * user's membership. Writes the row, an acknowledgement to the enquirer and an alert to ops in one transaction.
 */
export async function submitEnquiry(db: DbOrTx, raw: EnquiryInput, opts: { ip: string | null; orgId?: string | null }): Promise<{ ok: true; id: string } | { ok: false; issues: string[] }> {
  const parsed = enquiryInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => i.path.join('.') || 'input') };
  if (!(await allowPublicSubmission('enquiry', opts.ip, parsed.data.contactEmail))) return { ok: false, issues: ['rate_limited'] };
  const track = await getSellableTrack(db, { id: parsed.data.trackId });
  if (!track) return { ok: false, issues: ['trackId'] };
  const { contactPhone, budgetRange, ...rest } = parsed.data;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({ ...rest, contactPhone: contactPhone ?? null, budgetRange: budgetRange ?? null, orgId: opts.orgId ?? null })
      .returning({ id: enquiries.id });
    await enqueueEmail(tx, { kind: 'enquiry.ack', to: rest.contactEmail, template: 'enquiry_ack', payload: { contactName: rest.contactName, trackTitle: track.title } });
    await enqueueOpsAlert(tx, 'enquiry', 'New Commercial/Broadcast enquiry', { enquiryId: row!.id, trackId: track.id, media: rest.media });
    return { ok: true as const, id: row!.id };
  });
}

const isAdmin = (a: AdminContext) => a.permissions.length > 0;

/** Pipeline view (PLAN §9: any admin). */
export async function listEnquiries(db: DbOrTx, admin: AdminContext, status?: EnquiryStatus) {
  if (!isAdmin(admin)) throw new Error('Admins only');
  if (status && !ENQUIRY_STATUSES.includes(status)) throw new Error('unknown status');
  return db.select().from(enquiries).where(status ? eq(enquiries.status, status) : undefined).orderBy(asc(enquiries.createdAt)).limit(500);
}

/** new → contacted → closed_won | closed_lost (new can close lost directly). Compare-and-set, audited. */
export async function setEnquiryStatus(db: DbOrTx, admin: AdminContext, enquiryId: string, to: EnquiryStatus, ip?: string | null) {
  if (!isAdmin(admin)) throw new Error('Admins only');
  return db.transaction(async (tx) => {
    const [e] = await tx.select({ status: enquiries.status }).from(enquiries).where(eq(enquiries.id, enquiryId)).for('update');
    if (!e) return { ok: false as const, reason: 'not_found' as const };
    if (!ENQUIRY_TRANSITIONS.some((t) => t.from === e.status && t.to === to)) return { ok: false as const, reason: 'invalid' as const, status: e.status as EnquiryStatus };
    await tx.update(enquiries).set({ status: to, updatedAt: new Date() }).where(eq(enquiries.id, enquiryId));
    await writeAudit(tx, { actorUserId: admin.userId, action: 'enquiry.status', entityType: 'enquiry', entityId: enquiryId, before: { status: e.status }, after: { status: to }, ip });
    return { ok: true as const };
  });
}
