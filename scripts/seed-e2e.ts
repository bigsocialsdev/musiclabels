/**
 * Fixtures for the Playwright specs (tests/e2e): the reference data plus one verified seller with a published,
 * sellable track and one buyer organisation who has accepted the terms, found by the specs through their fixed names.
 * Idempotent. Run with: DATABASE_URL=... npm run seed:e2e   (a migrated local database; refuses to run in production)
 */
import { eq } from 'drizzle-orm';
import { memberships, organizations } from '@/db/schema';
import { getCurrentDocument, recordAcceptance } from '@/lib/legal/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeBuyer, makeSellableTrack, makeSeller } from '../tests/factories';
import { seedReference } from './seed-reference';

const E2E_SELLER = 'E2E Seller Pvt Ltd';
const E2E_BUYER = 'E2E Buyer LLP';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:e2e refuses to run in production');
  const db = getDb();
  await seedReference(db);
  const orgByName = async (name: string) => (await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.legalName, name)).limit(1))[0];

  if (!(await orgByName(E2E_SELLER))) {
    const seller = await makeSeller(db);
    await db.update(organizations).set({ legalName: E2E_SELLER, displayName: E2E_SELLER }).where(eq(organizations.id, seller.orgId));
    await makeSellableTrack(db, { sellerOrgId: seller.orgId });
  }
  const buyer = (await orgByName(E2E_BUYER)) ?? { id: (await makeBuyer(db, E2E_BUYER)).orgId };

  // Checkout needs the current terms and privacy policy accepted (acceptances are append-only; a duplicate is a no-op).
  const [owner] = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.orgId, buyer.id)).limit(1);
  for (const kind of ['tos', 'privacy'] as const) {
    const doc = await getCurrentDocument(db, kind);
    await recordAcceptance(db, { userId: owner!.userId, orgId: buyer.id, documentId: doc!.id });
  }
  console.log('seeded: reference data, e2e seller with a published track, e2e buyer who accepted the terms');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
