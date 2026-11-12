import { and, eq } from 'drizzle-orm';
import { memberships, organizations } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';

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

/** Tenant check: org ids from the client are inputs to verify, never trusted. */
export async function getMembershipRole(db: DbOrTx, userId: string, orgId: string): Promise<'owner' | 'member' | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
  return (row?.role as 'owner' | 'member' | undefined) ?? null;
}
