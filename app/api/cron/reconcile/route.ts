import { productionDeps, reconcilePayments } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (PLAN §5.7): reconcile the previous IST calendar day against Razorpay. */
export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  const IST = 330 * 60_000;
  const todayIst = Math.floor((Date.now() + IST) / 86_400_000) * 86_400_000 - IST;
  return Response.json(await reconcilePayments(getDb(), productionDeps(), new Date(todayIst - 86_400_000), new Date(todayIst)));
}
