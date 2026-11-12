import { sql } from 'drizzle-orm';
import { outbox } from '@/db/schema';
import { getDb, type DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { errorMessage, log } from '@/lib/platform/log';
import { render } from './templates';
import { ResendSender, type EmailSender } from './sender';

const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 10;
const BATCH = 25;

export type EmailMessage = {
  kind: string;
  to: string;
  template: string;
  payload?: Record<string, unknown>;
};

/** Call with the same transaction that makes the state change the email reports. */
export async function enqueueEmail(tx: DbOrTx, m: EmailMessage): Promise<string> {
  const [row] = await tx
    .insert(outbox)
    .values({ kind: m.kind, to: m.to, template: m.template, payload: m.payload ?? {} })
    .returning({ id: outbox.id });
  return row!.id;
}

/** Ops alert (PLAN §10 monitoring): logged now, emailed to OPS_ALERT_EMAIL via the outbox with the caller's transaction. */
export async function enqueueOpsAlert(tx: DbOrTx, kind: string, title: string, details: Record<string, unknown>): Promise<void> {
  log.error(`ops alert: ${title}`, { kind, ...details });
  await enqueueEmail(tx, { kind: `alert.${kind}`, to: getEnv().OPS_ALERT_EMAIL, template: 'system_alert', payload: { title, message: JSON.stringify(details) } });
}

type Claimed ={ id: string; to: string; template: string; payload: Record<string, unknown>; attempts: number };

/**
 * Claim = compare-and-set pending -> sending under FOR UPDATE SKIP LOCKED, so the after() run and
 * the cron sweep can overlap without sending twice. Rows stuck in `sending` (crashed run) are
 * reclaimed after STALE_CLAIM_MINUTES; Resend's idempotency key covers that rare double send.
 */
async function claim(db: DbOrTx, id?: string): Promise<Claimed[]> {
  const rows = await db.execute<{ id: string; to: string; template: string; payload: Record<string, unknown>; attempts: number }>(sql`
    UPDATE outbox SET status = 'sending', claimed_at = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox
      WHERE (status = 'pending' OR (status = 'sending' AND claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})))
        ${id ? sql`AND id = ${id}` : sql``}
      ORDER BY created_at
      LIMIT ${BATCH}
      FOR UPDATE SKIP LOCKED)
    RETURNING id, "to", template, payload, attempts`);
  return [...rows];
}

/** Idempotent handler: process one outbox row (`id`) or sweep everything pending. Returns the number sent. */
export async function processOutbox(opts: { id?: string } = {}, sender?: EmailSender): Promise<number> {
  const db = getDb();
  const claimed = await claim(db, opts.id);
  if (claimed.length === 0) return 0;
  const mail = sender ?? new ResendSender();
  let sent = 0;
  for (const row of claimed) {
    try {
      const { subject, html } = render(row.template, row.payload);
      await mail.send({ to: row.to, subject, html, idempotencyKey: row.id });
      await db.execute(sql`UPDATE outbox SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = ${row.id}`);
      sent++;
    } catch (e) {
      const status = row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
      await db.execute(sql`UPDATE outbox SET status = ${status}, last_error = ${errorMessage(e).slice(0, 500)} WHERE id = ${row.id}`);
    }
  }
  return sent;
}
