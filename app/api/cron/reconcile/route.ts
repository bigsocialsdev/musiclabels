import { productionDeps, reconcilePreviousDay } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { runCron } from '../run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (PLAN §5.7): reconcile the previous IST calendar day against Razorpay. */
export const GET = (req: Request) => runCron(req, 'reconcile', { reconciliation: () => reconcilePreviousDay(getDb(), productionDeps()) });
