import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { payoutAccounts } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext, type Session } from '@/lib/identity';
import { getMembershipRole, requireAal2 } from '@/lib/identity/server';
import { decrypt, encrypt, maskTail } from '@/lib/platform/crypto';
import type { DbOrTx } from '@/lib/platform/db';

export const payoutAccountInputSchema = z.object({
  accountNumber: z.string().trim().regex(/^[0-9]{9,18}$/, 'account number must be 9–18 digits'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'invalid IFSC'),
  accountHolderName: z.string().trim().min(2).max(140),
});
export type PayoutAccountInput = z.input<typeof payoutAccountInputSchema>;

export class PayoutAccountError extends Error {}

/**
 * Sets the seller's bank account (CLAUDE.md: payout-detail changes require AAL2; the number is encrypted and
 * shown masked). Only an owner of the seller org may change it. A change clears verification, so payouts wait
 * for finance to re-verify.
 */
export async function setPayoutAccount(db: DbOrTx, session: Session, sellerOrgId: string, raw: PayoutAccountInput, ip?: string | null): Promise<void> {
  const guard = requireAal2(session);
  if (!guard.ok) throw new PayoutAccountError(guard.reason);
  if ((await getMembershipRole(db, session.userId, sellerOrgId)) !== 'owner') throw new PayoutAccountError('forbidden');
  const input = payoutAccountInputSchema.parse(raw);
  const values = {
    accountNumberEncrypted: encrypt(input.accountNumber),
    ifsc: input.ifsc,
    accountHolderName: input.accountHolderName,
    nameMatchStatus: 'unchecked',
    verifiedAt: null,
    verifiedBy: null,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(payoutAccounts).values({ sellerOrgId, ...values }).onConflictDoUpdate({ target: payoutAccounts.sellerOrgId, set: values });
    await writeAudit(tx, {
      actorUserId: session.userId,
      action: 'payout_account.set',
      entityType: 'seller_org',
      entityId: sellerOrgId,
      after: { account: maskTail(input.accountNumber), ifsc: input.ifsc },
      ip,
    });
  });
}

/** Finance confirms the account (e.g. after a penny-drop or bank letter). Audited. */
export async function verifyPayoutAccount(db: DbOrTx, admin: AdminContext, sellerOrgId: string, nameMatches: boolean, ip?: string | null): Promise<boolean> {
  requirePermission(admin, 'finance');
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(payoutAccounts)
      .set({ verifiedAt: nameMatches ? sql`now()` : null, verifiedBy: admin.userId, nameMatchStatus: nameMatches ? 'matched' : 'mismatch', updatedAt: new Date() })
      .where(eq(payoutAccounts.sellerOrgId, sellerOrgId))
      .returning({ id: payoutAccounts.sellerOrgId });
    if (rows.length) await writeAudit(tx, { actorUserId: admin.userId, action: 'payout_account.verify', entityType: 'seller_org', entityId: sellerOrgId, after: { nameMatches }, ip });
    return rows.length > 0;
  });
}

export type PayoutAccountView = { maskedAccount: string; ifsc: string; accountHolderName: string; verified: boolean };

export async function getPayoutAccount(db: DbOrTx, sellerOrgId: string): Promise<PayoutAccountView | null> {
  const [a] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.sellerOrgId, sellerOrgId));
  if (!a) return null;
  return { maskedAccount: maskTail(decrypt(a.accountNumberEncrypted)), ifsc: a.ifsc, accountHolderName: a.accountHolderName, verified: a.verifiedAt !== null };
}

/** Payout rail only: the clear account number for a verified account. Never shown in UI or logs. */
export async function getVerifiedBankDetails(db: DbOrTx, sellerOrgId: string) {
  const [a] = await db.select().from(payoutAccounts).where(eq(payoutAccounts.sellerOrgId, sellerOrgId));
  if (!a?.verifiedAt) return null;
  return { accountNumber: decrypt(a.accountNumberEncrypted), ifsc: a.ifsc, accountHolderName: a.accountHolderName };
}
