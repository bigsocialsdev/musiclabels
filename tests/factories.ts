import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { memberships, organizations, sellerProfiles, trackVersions, tracks, users } from '@/db/schema';
import type { Db } from '@/lib/platform/db';
import { uuidv7 } from '@/lib/platform/ids';
import type { AdminPermission, Session } from '@/lib/identity';

/** Inserts a user row and returns a matching session. */
export async function makeUser(
  db: Db,
  opts: { admin?: AdminPermission[]; aal?: Session['aal']; verified?: boolean } = {},
): Promise<Session> {
  const id = uuidv7();
  const email = `${id}@example.com`;
  await db.insert(users).values({
    id,
    email,
    verifiedAt: new Date(),
    platformRole: opts.admin ? 'admin' : 'none',
    adminPermissions: opts.admin ?? [],
  });
  return { userId: id, email, phone: null, verified: opts.verified ?? true, aal: opts.aal ?? 'aal1' };
}

/** A seller org with an owner user (and a session for that user) plus a seller profile. */
export async function makeSeller(db: Db, opts: { kyc?: 'pending' | 'verified' | 'rejected'; opsEmail?: string | null } = {}) {
  const owner = await makeUser(db);
  const [org] = await db
    .insert(organizations)
    .values({ kind: 'seller', legalName: 'Seller Pvt Ltd', displayName: 'Seller' })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ userId: owner.userId, orgId: org!.id, role: 'owner' });
  await db.insert(sellerProfiles).values({
    orgId: org!.id,
    entityType: 'company',
    kycStatus: opts.kyc ?? 'verified',
    opsContactEmail: opts.opsEmail === undefined ? 'ops@seller.example' : opts.opsEmail,
    worldwideRightsWarranted: true,
  });
  return { owner, orgId: org!.id };
}

/** A buyer org with an owner user; `owner` is a session for that user. */
export async function makeBuyer(db: Db, legalName = 'Buyer Media LLP') {
  const owner = await makeUser(db);
  const [org] = await db
    .insert(organizations)
    .values({ kind: 'buyer', buyerType: 'business', legalName, displayName: legalName })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ userId: owner.userId, orgId: org!.id, role: 'owner' });
  return { owner, orgId: org!.id };
}

/** A published, class A track with a ready version, offered for organic and paid-ad use at price level L2. */
export async function makeSellableTrack(
  db: Db,
  opts: { sellerOrgId?: string; clearanceClass?: 'A' | 'B' | 'C'; status?: string; paidAds?: boolean; organicSocial?: boolean; priceLevel?: string | null } = {},
) {
  const sellerOrgId = opts.sellerOrgId ?? (await makeSeller(db)).orgId;
  const trackId = await makeTrack(db, sellerOrgId, opts.status ?? 'published');
  const [v] = await db
    .insert(trackVersions)
    .values({ trackId, versionNo: 1, masterKey: `${trackId}/master.wav`, masterSha256: randomBytes(32).toString('hex'), ingestStatus: 'ready' })
    .returning({ id: trackVersions.id });
  await db
    .update(tracks)
    .set({
      currentVersionId: v!.id,
      clearanceClass: opts.clearanceClass ?? 'A',
      priceLevel: opts.priceLevel === undefined ? 'L2' : opts.priceLevel,
      paidAds: opts.paidAds ?? true,
      organicSocial: opts.organicSocial ?? true,
      publishedAt: new Date(),
    })
    .where(eq(tracks.id, trackId));
  return { trackId, trackVersionId: v!.id, sellerOrgId };
}

let counter = 0;
export async function makeTrack(db: Db, orgId: string, status: string = 'draft') {
  const [t] = await db
    .insert(tracks)
    .values({
      sellerOrgId: orgId,
      slug: `t-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'Test Track',
      primaryArtist: 'Artist',
      language: 'english',
      status,
    })
    .returning({ id: tracks.id });
  return t!.id;
}
