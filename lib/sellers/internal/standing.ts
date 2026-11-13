import { and, eq, sql } from 'drizzle-orm';
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

/**
 * Moves a seller between `active` and `suspended` (the accounts slice does this with an org suspension). A closed
 * account is never touched. Returns the status before, or null when nothing changed (no profile, or already there).
 */
export async function setSellerStatus(db: DbOrTx, orgId: string, to: 'active' | 'suspended'): Promise<'active' | 'suspended' | null> {
  const from = to === 'suspended' ? 'active' : 'suspended';
  const rows = await db.update(sellerProfiles).set({ status: to }).where(and(eq(sellerProfiles.orgId, orgId), eq(sellerProfiles.status, from))).returning({ id: sellerProfiles.orgId });
  return rows.length ? from : null;
}
