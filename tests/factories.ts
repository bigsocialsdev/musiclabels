import { memberships, organizations, sellerProfiles, tracks, users } from '@/db/schema';
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
