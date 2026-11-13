import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { memberships, organizations, users } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { OrgAccessError, OrgSuspendedError, type OrgActor } from '../index';

export type NewOrganization = {
  kind: 'seller' | 'buyer';
  legalName: string;
  displayName: string;
  buyerType?: 'individual' | 'business' | 'agency';
};

/** Creates the org and makes the caller its owner, atomically. An individual creator is a one-member org. Refused (`OrgSuspendedError`) for a member of a suspended org of the same kind. */
export async function createOrganization(db: DbOrTx, userId: string, input: NewOrganization) {
  return db.transaction(async (tx) => {
    const [suspended] = await tx
      .select({ id: organizations.id })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, userId), eq(organizations.kind, input.kind), isNotNull(organizations.suspendedAt)))
      .limit(1);
    if (suspended) throw new OrgSuspendedError();
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
    .select({ id: organizations.id, legalName: organizations.legalName, buyerType: organizations.buyerType, verifyFullName: organizations.verifyFullName, suspendedAt: organizations.suspendedAt, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(organizations.kind, 'buyer')));
}

export async function getOrganization(db: DbOrTx, orgId: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  return row ?? null;
}

/**
 * Tenant check: org ids from the client are inputs to verify, never trusted. Almost every org-scoped read and write
 * goes through this, so a **suspended** org answers "not a member" here and its members are locked out everywhere at once.
 */
export async function getMembershipRole(db: DbOrTx, userId: string, orgId: string): Promise<'owner' | 'member' | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId), isNull(organizations.suspendedAt)));
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
    .select({ id: organizations.id, legalName: organizations.legalName, displayName: organizations.displayName, suspendedAt: organizations.suspendedAt, role: memberships.role })
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

/**
 * Marks an org suspended or in good standing (admin suspension, S4-M10c; the accounts slice orchestrates it and audits it).
 * Compare-and-set: returns false when the org is already in the requested state or does not exist, and changes nothing.
 */
export async function setOrgSuspension(db: DbOrTx, orgId: string, change: { suspend: true; reason: string } | { suspend: false }): Promise<boolean> {
  const rows = change.suspend
    ? await db.update(organizations).set({ suspendedAt: new Date(), suspensionReason: change.reason }).where(and(eq(organizations.id, orgId), isNull(organizations.suspendedAt))).returning({ id: organizations.id })
    : await db.update(organizations).set({ suspendedAt: null, suspensionReason: null }).where(and(eq(organizations.id, orgId), isNotNull(organizations.suspendedAt))).returning({ id: organizations.id });
  return rows.length > 0;
}
