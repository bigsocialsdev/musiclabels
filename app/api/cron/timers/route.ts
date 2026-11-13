import { markOverdue } from '@/lib/clearance/server';
import { sweepDisputes } from '@/lib/disputes/server';
import { getDb } from '@/lib/platform/db';
import { errorMessage } from '@/lib/platform/log';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily (PLAN §5.8, F10): clearance requests past due_at become overdue (reminder to the seller, notices to the
 * buyer and ops); disputes get their overdue notice, refund eligibility and refunded settlement. Each part is
 * idempotent and isolated from the other's failure.
 */
export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  const db = getDb();
  const run = <T,>(f: () => Promise<T>) => Promise.resolve().then(f).catch((e: unknown) => ({ error: errorMessage(e) }));
  return Response.json({ clearanceOverdue: await run(() => markOverdue(db)), disputes: await run(() => sweepDisputes(db)) });
}
