import { asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { memberships, organizations, sellerProfiles, users } from '@/db/schema';
import { requirePermission, type AdminContext } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import { MIN_SEARCH_LENGTH, SEARCH_LIMIT } from '../index';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Users by email, phone or name and orgs by legal or display name (superadmin). Too-short queries return nothing. Not audited: it shows names, not the org's data. */
export async function searchAccounts(db: DbOrTx, admin: AdminContext, q: string) {
  requirePermission(admin, 'superadmin');
  const term = q.trim();
  if (term.length < MIN_SEARCH_LENGTH) return { users: [], orgs: [] };
  const like = `%${escapeLike(term)}%`;

  const foundUsers = await db
    .select({ id: users.id, email: users.email, phone: users.phone, name: users.name, platformRole: users.platformRole })
    .from(users)
    .where(or(ilike(users.email, like), ilike(users.phone, like), ilike(users.name, like)))
    .orderBy(asc(users.email))
    .limit(SEARCH_LIMIT);
  const memberOf = foundUsers.length
    ? await db
        .select({ userId: memberships.userId, orgId: organizations.id, name: organizations.displayName, role: memberships.role })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.orgId))
        .where(inArray(memberships.userId, foundUsers.map((u) => u.id)))
    : [];

  const foundOrgs = await db
    .select({
      id: organizations.id,
      kind: organizations.kind,
      legalName: organizations.legalName,
      displayName: organizations.displayName,
      suspendedAt: organizations.suspendedAt,
      sellerStatus: sellerProfiles.status,
      kycStatus: sellerProfiles.kycStatus,
      members: sql<number>`(select count(*)::int from ${memberships} m where m.org_id = ${organizations.id})`,
    })
    .from(organizations)
    .leftJoin(sellerProfiles, eq(sellerProfiles.orgId, organizations.id))
    .where(or(ilike(organizations.legalName, like), ilike(organizations.displayName, like)))
    .orderBy(desc(organizations.createdAt))
    .limit(SEARCH_LIMIT);

  return { users: foundUsers.map((u) => ({ ...u, orgs: memberOf.filter((m) => m.userId === u.id) })), orgs: foundOrgs };
}
