import { desc, eq, sql } from 'drizzle-orm';
import { licenses, memberships, orders, organizations, sellerProfiles, tracks, users } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';

export type OrgSummary = NonNullable<Awaited<ReturnType<typeof viewOrgSummary>>>;

/**
 * The read-only view of an org for support (PLAN §9 "read-only impersonation"): what its members would see, without a
 * session swap and without writing anything on their behalf. Every view writes an `org.view_summary` audit row naming
 * the admin, in the same transaction as the read. Null when the org does not exist (nothing is audited then).
 * Deliberately left out: PAN, bank details, document contents. Those have their own audited downloads.
 */
export async function viewOrgSummary(db: DbOrTx, admin: AdminContext, orgId: string, ip?: string | null) {
  requirePermission(admin, 'superadmin');
  return db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) return null;
    const members = await tx
      .select({ userId: users.id, email: users.email, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(memberships.createdAt);
    const [seller] = await tx
      .select({
        status: sellerProfiles.status,
        kycStatus: sellerProfiles.kycStatus,
        entityType: sellerProfiles.entityType,
        onboardingMode: sellerProfiles.onboardingMode,
        gstRegistered: sellerProfiles.gstRegistered,
        opsContactEmail: sellerProfiles.opsContactEmail,
        hasPan: sql<boolean>`${sellerProfiles.panEncrypted} is not null`,
      })
      .from(sellerProfiles)
      .where(eq(sellerProfiles.orgId, orgId));
    const trackCounts = await tx
      .select({ status: tracks.status, n: sql<number>`count(*)::int` })
      .from(tracks)
      .where(eq(tracks.sellerOrgId, orgId))
      .groupBy(tracks.status);
    const recentOrders = await tx
      .select({ id: orders.id, status: orders.status, tier: orders.tier, totalPaise: orders.totalPaise, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.buyerOrgId, orgId))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(10);
    const [licenseCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(licenses).where(eq(licenses.purchaserOrgId, orgId));

    await writeAudit(tx, { actorUserId: admin.userId, action: 'org.view_summary', entityType: 'organization', entityId: orgId, after: { kind: org.kind, suspended: org.suspendedAt !== null }, ip });
    return { org, members, seller: seller ?? null, trackCounts, recentOrders, licenseCount: licenseCount?.n ?? 0 };
  });
}
