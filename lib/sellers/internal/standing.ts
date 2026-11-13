import { eq } from 'drizzle-orm';
import { sellerProfiles } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';

export type SellerStanding = {
  kycStatus: 'pending' | 'verified' | 'rejected';
  status: 'active' | 'suspended' | 'closed';
  opsContactEmail: string | null;
  worldwideRightsWarranted: boolean;
  royaltyRateBps: number | null; // contract rate; null = platform default from config
};

/** The facts about a seller org that gate catalog actions. Null when the org has no seller profile yet. */
export async function getSellerStanding(db: DbOrTx, orgId: string): Promise<SellerStanding | null> {
  const [row] = await db
    .select({
      kycStatus: sellerProfiles.kycStatus,
      status: sellerProfiles.status,
      opsContactEmail: sellerProfiles.opsContactEmail,
      worldwideRightsWarranted: sellerProfiles.worldwideRightsWarranted,
      royaltyRateBps: sellerProfiles.royaltyRateBps,
    })
    .from(sellerProfiles)
    .where(eq(sellerProfiles.orgId, orgId));
  return (row as SellerStanding | undefined) ?? null;
}
