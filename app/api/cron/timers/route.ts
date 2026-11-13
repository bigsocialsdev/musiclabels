import { markOverdue } from '@/lib/clearance/server';
import { sweepDisputes } from '@/lib/disputes/server';
import { getDb } from '@/lib/platform/db';
import { runCron } from '../run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily (PLAN §5.8, F10): clearance requests past due_at become overdue (reminder to the seller, notices to the
 * buyer and ops); disputes get their overdue notice, refund eligibility and refunded settlement. Each part is
 * idempotent and isolated from the other's failure.
 */
export const GET = (req: Request) => runCron(req, 'timers', { clearanceOverdue: () => markOverdue(getDb()), disputes: () => sweepDisputes(getDb()) });
