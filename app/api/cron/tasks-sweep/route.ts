import { sweepCatalog } from '@/lib/catalog/server';
import { productionDeps, sweepOrders } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { errorMessage } from '@/lib/platform/log';
import { processOutbox } from '@/lib/notifications/server';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Backstop: reruns every background handler over rows still waiting. Later milestones add theirs here. */
export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  // Before the outbox, so license emails go out this run; isolated so a payments problem cannot stop the rest.
  const orders = await Promise.resolve()
    .then(() => sweepOrders(getDb(), productionDeps()))
    .catch((e: unknown) => ({ error: errorMessage(e) }));
  return Response.json({ orders, outboxSent: await processOutbox(), catalogProcessed: await sweepCatalog(3) });
}
