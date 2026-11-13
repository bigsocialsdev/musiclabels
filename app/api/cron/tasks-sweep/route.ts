import { refreshStaleCertificates } from '@/lib/certificates/server';
import { sweepCatalog } from '@/lib/catalog/server';
import { backfillClearance, dispatchClearance } from '@/lib/clearance/server';
import { processOutbox } from '@/lib/notifications/server';
import { productionDeps, sweepOrders } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { runCron } from '../run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Backstop: reruns every background handler over rows still waiting. Orders first, then clearance, so the outbox
 * (which comes after them) sends their emails in this run; each part is isolated so one failure cannot stop the rest.
 */
export const GET = (req: Request) =>
  runCron(req, 'tasks-sweep', {
    orders: () => sweepOrders(getDb(), productionDeps()),
    clearance: async () => ({ backfilled: await backfillClearance(getDb()), sent: await dispatchClearance(getDb()) }),
    certificates: () => refreshStaleCertificates(getDb(), productionDeps().store),
    outboxSent: () => processOutbox(),
    catalogProcessed: () => sweepCatalog(3),
  });
