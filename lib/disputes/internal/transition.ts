import { and, eq } from 'drizzle-orm';
import { disputeEvents, disputes } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { listOrgOwnerEmails } from '@/lib/identity/server';
import { enqueueEmail } from '@/lib/notifications/server';
import type { DbOrTx } from '@/lib/platform/db';
import { nextDisputeStatus, type DisputeEvent, type DisputeStatus } from '../index';

export type DisputeRow = typeof disputes.$inferSelect;

export type DisputeTransitionResult =
  | { ok: true; from: DisputeStatus; to: DisputeStatus }
  | { ok: false; reason: 'not_found' | 'invalid' | 'conflict'; status?: DisputeStatus };

type Patch = Partial<Pick<DisputeRow, 'resolution' | 'closedAt' | 'claimantCataloged'>>;

/**
 * Moves a dispute through the transition table as a compare-and-set `UPDATE ... WHERE id AND status = $from`,
 * and writes its `dispute_events` row and an `audit_log` row (system actor when `actorUserId` is null) in the
 * same transaction. Zero rows updated = someone else moved it first: return the current state and do nothing.
 */
export async function applyDisputeTransition(
  db: DbOrTx,
  id: string,
  event: DisputeEvent,
  opts: { actorUserId: string | null; note?: string | null; set?: Patch; ip?: string | null },
): Promise<DisputeTransitionResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ status: disputes.status }).from(disputes).where(eq(disputes.id, id));
    if (!current) return { ok: false, reason: 'not_found' } as const;
    const from = current.status as DisputeStatus;
    const to = nextDisputeStatus(from, event);
    if (!to) return { ok: false, reason: 'invalid', status: from } as const;
    const updated = await tx
      .update(disputes)
      .set({ ...opts.set, status: to, updatedAt: new Date() })
      .where(and(eq(disputes.id, id), eq(disputes.status, from)))
      .returning({ id: disputes.id });
    if (updated.length === 0) {
      const [now] = await tx.select({ status: disputes.status }).from(disputes).where(eq(disputes.id, id));
      return { ok: false, reason: 'conflict', status: now?.status as DisputeStatus | undefined } as const;
    }
    await tx.insert(disputeEvents).values({ disputeId: id, kind: event, note: opts.note ?? null, actorUserId: opts.actorUserId });
    await writeAudit(tx, { actorUserId: opts.actorUserId, action: `dispute.${event}`, entityType: 'dispute', entityId: id, before: { status: from }, after: { status: to, note: opts.note ?? null }, ip: opts.ip });
    return { ok: true, from, to } as const;
  });
}

/** Emails every owner of the buyer org; written with the caller's transaction. */
export async function notifyOrg(tx: DbOrTx, orgId: string, kind: string, subject: string, message: string): Promise<void> {
  for (const to of await listOrgOwnerEmails(tx, orgId)) await enqueueEmail(tx, { kind, to, template: 'dispute_update', payload: { subject, message } });
}
