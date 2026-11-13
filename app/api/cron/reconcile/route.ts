import { productionDeps, reconcilePreviousDay } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (PLAN §5.7): reconcile the previous IST calendar day against Razorpay. */
export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  return Response.json(await reconcilePreviousDay(getDb(), productionDeps()));
}
