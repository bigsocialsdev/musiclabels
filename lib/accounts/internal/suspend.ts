import { eq } from 'drizzle-orm';
import { organizations } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { pauseOrgTracks, resumeOrgTracks } from '@/lib/catalog/server';
import { requirePermission, setOrgSuspension, type AdminContext } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import { setSellerStatus } from '@/lib/sellers/server';
import { SUSPENSION_REASON_MAX, type ReinstateOutcome, type SuspendOutcome } from '../index';

const cleanReason = (reason: string) => {
  const r = reason.trim();
  if (!r || r.length > SUSPENSION_REASON_MAX) throw new Error(`A reason of 1 to ${SUSPENSION_REASON_MAX} characters is required`);
  return r;
};

/**
 * Suspends an org (superadmin): its members lose access to it everywhere (`getMembershipRole` answers "not a member"),
 * and for a seller its account is marked suspended and its published tracks come off sale. Licenses already issued
 * are untouched. One transaction: the org flag, the seller status, the tracks, and the audit row that lists the
 * tracks it paused. Suspending an org that is already suspended changes nothing.
 */
export async function suspendOrg(db: DbOrTx, admin: AdminContext, input: { orgId: string; reason: string }, ip?: string | null): Promise<SuspendOutcome> {
  requirePermission(admin, 'superadmin');
  const reason = cleanReason(input.reason);
  return db.transaction(async (tx) => {
    const [org] = await tx.select({ kind: organizations.kind }).from(organizations).where(eq(organizations.id, input.orgId)).for('update');
    if (!org) return { ok: false, reason: 'not_found' } as const;
    if (!(await setOrgSuspension(tx, input.orgId, { suspend: true, reason }))) return { ok: false, reason: 'already_suspended' } as const;
    const sellerSuspended = org.kind === 'seller' && (await setSellerStatus(tx, input.orgId, 'suspended')) !== null;
    const paused = org.kind === 'seller' ? await pauseOrgTracks(tx, input.orgId, admin.userId, ip) : [];
    await writeAudit(tx, { actorUserId: admin.userId, action: 'org.suspend', entityType: 'organization', entityId: input.orgId, before: { suspended: false }, after: { suspended: true, reason, kind: org.kind, sellerSuspended, pausedTrackIds: paused }, ip });
    return { ok: true, pausedTracks: paused.length, sellerSuspended } as const;
  });
}

/**
 * Reverses `suspendOrg`: access returns, the seller account is active again, and the tracks that suspension paused
 * (and only those: not a track an admin suspended for a rights problem, nor a class C track) go back on sale.
 */
export async function reinstateOrg(db: DbOrTx, admin: AdminContext, input: { orgId: string; reason: string }, ip?: string | null): Promise<ReinstateOutcome> {
  requirePermission(admin, 'superadmin');
  const reason = cleanReason(input.reason);
  return db.transaction(async (tx) => {
    const [org] = await tx.select({ kind: organizations.kind }).from(organizations).where(eq(organizations.id, input.orgId)).for('update');
    if (!org) return { ok: false, reason: 'not_found' } as const;
    if (!(await setOrgSuspension(tx, input.orgId, { suspend: false }))) return { ok: false, reason: 'not_suspended' } as const;
    const sellerReinstated = org.kind === 'seller' && (await setSellerStatus(tx, input.orgId, 'active')) !== null;
    const resumed = org.kind === 'seller' ? await resumeOrgTracks(tx, input.orgId, admin.userId, ip) : [];
    await writeAudit(tx, { actorUserId: admin.userId, action: 'org.reinstate', entityType: 'organization', entityId: input.orgId, before: { suspended: true }, after: { suspended: false, reason, kind: org.kind, sellerReinstated, resumedTrackIds: resumed }, ip });
    return { ok: true, resumedTracks: resumed.length, sellerReinstated } as const;
  });
}
