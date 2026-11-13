import { and, eq } from 'drizzle-orm';
import { memberships, organizations, users } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { OrgAccessError, type OrgActor } from '../index';

export type NewOrganization = {
  kind: 'seller' | 'buyer';
  legalName: string;
  displayName: string;
  buyerType?: 'individual' | 'business' | 'agency';
};

/** Creates the org and makes the caller its owner, atomically. An individual creator is a one-member org. */
export async function createOrganization(db: DbOrTx, userId: string, input: NewOrganization) {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({
        kind: input.kind,
        legalName: input.legalName,
        displayName: input.displayName,
        buyerType: input.kind === 'buyer' ? (input.buyerType ?? 'individual') : null,
      })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({ userId, orgId: org!.id, role: 'owner' });
    return org!.id;
  });
}

/** The buyer orgs a user can purchase for (any membership role). */
export async function listBuyerOrgs(db: DbOrTx, userId: string) {
  return db
    .select({ id: organizations.id, legalName: organizations.legalName, buyerType: organizations.buyerType, verifyFullName: organizations.verifyFullName, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(organizations.kind, 'buyer')));
}

export async function getOrganization(db: DbOrTx, orgId: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  return row ?? null;
}

/** Tenant check: org ids from the client are inputs to verify, never trusted. */
export async function getMembershipRole(db: DbOrTx, userId: string, orgId: string): Promise<'owner' | 'member' | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  return (row?.role as 'owner' | 'member' | undefined) ?? null;
}

/** Throws `OrgAccessError` unless the actor belongs to their org; returns their role. */
export async function requireOrgMember(db: DbOrTx, actor: OrgActor): Promise<'owner' | 'member'> {
  const role = await getMembershipRole(db, actor.userId, actor.orgId);
  if (!role) throw new OrgAccessError();
  return role;
}

/** Owner emails of an org: where notices for the org go. */
export async function listOrgOwnerEmails(db: DbOrTx, orgId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
  return rows.flatMap((r) => (r.email ? [r.email] : []));
}

/** The seller orgs a user belongs to. */
export async function listSellerOrgs(db: DbOrTx, userId: string) {
  return db
    .select({ id: organizations.id, legalName: organizations.legalName, displayName: organizations.displayName, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(organizations.kind, 'seller')))
    .orderBy(organizations.id); // uuidv7: oldest first, so callers that take the first org get a stable one
}

/**
 * An individual buyer's choice to show their full name, not a masked one, on the public verify page (PLAN §7). Owner only;
 * businesses and agencies are always shown in full, so the setting does not apply to them.
 */
export async function setVerifyFullName(db: DbOrTx, actor: OrgActor, value: boolean): Promise<'ok' | 'not_individual'> {
  if ((await requireOrgMember(db, actor)) !== 'owner') throw new OrgAccessError();
  const rows = await db
    .update(organizations)
    .set({ verifyFullName: value })
    .where(and(eq(organizations.id, actor.orgId), eq(organizations.kind, 'buyer'), eq(organizations.buyerType, 'individual')))
    .returning({ id: organizations.id });
  return rows.length ? 'ok' : 'not_individual';
}
