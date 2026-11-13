import { eq, sql } from 'drizzle-orm';
import { sellerProfiles } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';

export type SellerStanding = {
  kycStatus: 'pending' | 'verified' | 'rejected';
  status: 'active' | 'suspended' | 'closed';
  opsContactEmail: string | null;
  worldwideRightsWarranted: boolean;
  royaltyRateBps: number | null; // contract rate; null = platform default from config
  gstRegistered: boolean;
  hasPan: boolean; // TDS rate depends on it; the PAN itself stays encrypted
};

/** The facts about a seller org that gate catalog and payout actions. Null when the org has no seller profile yet. */
export async function getSellerStanding(db: DbOrTx, orgId: string): Promise<SellerStanding | null> {
  const [row] = await db
    .select({
      kycStatus: sellerProfiles.kycStatus,
      status: sellerProfiles.status,
      opsContactEmail: sellerProfiles.opsContactEmail,
      worldwideRightsWarranted: sellerProfiles.worldwideRightsWarranted,
      royaltyRateBps: sellerProfiles.royaltyRateBps,
      gstRegistered: sellerProfiles.gstRegistered,
      hasPan: sql<boolean>`${sellerProfiles.panEncrypted} is not null`,
    })
    .from(sellerProfiles)
    .where(eq(sellerProfiles.orgId, orgId));
  return (row as SellerStanding | undefined) ?? null;
}
