import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { licenseEvents, licenses } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';
import { nextLicenseStatus, type LicenseEvent, type LicenseStatus, type RevocationReason } from '../index';

export type LicenseTransitionResult =
  | { ok: true; from: LicenseStatus; to: LicenseStatus }
  | { ok: false; reason: 'not_found' | 'invalid' | 'not_due' | 'conflict'; status?: LicenseStatus };

type TransitionOpts = { actorUserId: string | null; reason?: string | null; revokedReason?: RevocationReason; ip?: string | null };

const dueNow = and(isNotNull(licenses.endsAt), lte(licenses.endsAt, sql`now()`));

/**
 * Compare-and-set `UPDATE … WHERE id = $1 AND status = $from`, with the license_events row and an audit row
 * (license transitions are admin or system actions) in the same transaction. `expire` also requires
 * ends_at ≤ now() in the same WHERE, using database time as the DB trigger does.
 * Zero rows updated means another actor moved it first (or it is not due): return the current status, do nothing.
 */
export async function applyLicenseTransition(db: DbOrTx, licenseId: string, event: LicenseEvent, opts: TransitionOpts): Promise<LicenseTransitionResult> {
  if (event === 'revoke' && !opts.revokedReason) throw new Error('revoke needs a revocation reason');
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: licenses.status }).from(licenses).where(eq(licenses.id, licenseId));
    if (!current) return { ok: false, reason: 'not_found' } as const;
    const from = current.status as LicenseStatus;
    const to = nextLicenseStatus(from, event);
    if (!to) return { ok: false, reason: 'invalid', status: from } as const;

    const updated = await tx
      .update(licenses)
      .set(
        event === 'revoke'
          ? { status: to, revokedReason: opts.revokedReason!, revokedAt: sql`now()`, updatedAt: sql`now()` }
          : { status: to, updatedAt: sql`now()` },
      )
      .where(and(eq(licenses.id, licenseId), eq(licenses.status, from), event === 'expire' ? dueNow : undefined))
      .returning({ id: licenses.id });
    if (updated.length === 0) {
      const [again] = await tx.select({ status: licenses.status }).from(licenses).where(eq(licenses.id, licenseId));
      const status = again?.status as LicenseStatus | undefined;
      return { ok: false, reason: status === from ? 'not_due' : 'conflict', status } as const;
    }

    await tx.insert(licenseEvents).values({ licenseId, fromStatus: from, toStatus: to, event, actorUserId: opts.actorUserId, reason: opts.reason ?? null });
    await writeAudit(tx, {
      actorUserId: opts.actorUserId,
      action: `license.${event}`,
      entityType: 'license',
      entityId: licenseId,
      before: { status: from },
      after: { status: to, ...(opts.revokedReason ? { revokedReason: opts.revokedReason } : {}), note: opts.reason ?? null },
      ip: opts.ip,
    });
    return { ok: true, from, to } as const;
  });
}

/**
 * System revocation for refunds and lost chargebacks (S3-M5 calls this inside its own transaction, so the
 * credit note, ledger reversal and revocation commit together).
 */
export function revokeLicense(
  db: DbOrTx,
  licenseId: string,
  input: { reason: RevocationReason; note?: string | null; actorUserId?: string | null },
): Promise<LicenseTransitionResult> {
  return applyLicenseTransition(db, licenseId, 'revoke', { actorUserId: input.actorUserId ?? null, revokedReason: input.reason, reason: input.note });
}

/** Admin revocation for fraud or breach (PLAN §4.4); refund and chargeback revocations come only from S3-M5. */
export async function adminRevokeLicense(
  db: DbOrTx,
  admin: AdminContext,
  licenseId: string,
  input: { reason: 'fraud' | 'breach'; note: string },
  ip?: string | null,
): Promise<LicenseTransitionResult> {
  requirePermission(admin, 'disputes');
  const note = input.note.trim();
  if (!note) throw new Error('a revocation note is required');
  return applyLicenseTransition(db, licenseId, 'revoke', { actorUserId: admin.userId, revokedReason: input.reason, reason: note, ip });
}

/**
 * `licenses-expire` sweep: fixed-term licenses past ends_at → expired, as system transitions. Safe to run
 * concurrently and repeatedly (each row is a compare-and-set). Returns how many it expired.
 */
export async function expireLicenses(db: DbOrTx, batch = 200): Promise<number> {
  let expired = 0;
  for (;;) {
    const due = await db
      .select({ id: licenses.id })
      .from(licenses)
      .where(and(eq(licenses.status, 'active'), dueNow))
      .orderBy(asc(licenses.endsAt))
      .limit(batch);
    let moved = 0;
    for (const { id } of due) {
      if ((await applyLicenseTransition(db, id, 'expire', { actorUserId: null, reason: 'term ended' })).ok) moved++;
    }
    expired += moved;
    if (due.length < batch || moved === 0) return expired;
  }
}
