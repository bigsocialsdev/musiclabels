import { asc, eq, inArray, sql } from 'drizzle-orm';
import { memberships, organizations, sellerDocuments, sellerProfiles, users } from '@/db/schema';
import { requirePermission, type AdminContext } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';

export type KycQueueRow = Awaited<ReturnType<typeof listKycQueue>>[number];

/**
 * Sellers waiting on (or past) KYC review, oldest first (`verification`): what they submitted and whether each document
 * passed its file checks. Opening a document and deciding use the sellers slice's audited `sellerDocumentDownloadUrl` and
 * `setKycStatus`. The PAN is never returned, only whether one is on file.
 */
export async function listKycQueue(db: DbOrTx, admin: AdminContext, status: 'pending' | 'verified' | 'rejected' = 'pending') {
  requirePermission(admin, 'verification');
  const rows = await db
    .select({
      orgId: organizations.id,
      displayName: organizations.displayName,
      legalName: organizations.legalName,
      entityType: sellerProfiles.entityType,
      onboardingMode: sellerProfiles.onboardingMode,
      gstin: sellerProfiles.gstin,
      hasPan: sql<boolean>`${sellerProfiles.panEncrypted} is not null`,
      kycStatus: sellerProfiles.kycStatus,
      sellerStatus: sellerProfiles.status,
      since: sellerProfiles.createdAt,
      ownerEmail: sql<string | null>`(select u.email from ${memberships} m join ${users} u on u.id = m.user_id where m.org_id = ${organizations.id} and m.role = 'owner' order by m.created_at limit 1)`,
    })
    .from(sellerProfiles)
    .innerJoin(organizations, eq(organizations.id, sellerProfiles.orgId))
    .where(eq(sellerProfiles.kycStatus, status))
    .orderBy(asc(sellerProfiles.createdAt))
    .limit(100);
  const docs = rows.length
    ? await db
        .select({ id: sellerDocuments.id, orgId: sellerDocuments.sellerOrgId, kind: sellerDocuments.kind, status: sellerDocuments.validationStatus, error: sellerDocuments.validationError, uploadedAt: sellerDocuments.uploadedAt })
        .from(sellerDocuments)
        .where(inArray(sellerDocuments.sellerOrgId, rows.map((r) => r.orgId)))
        .orderBy(asc(sellerDocuments.uploadedAt))
    : [];
  return rows.map((r) => ({ ...r, documents: docs.filter((d) => d.orgId === r.orgId) }));
}
