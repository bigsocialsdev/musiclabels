import { sweepCatalog } from '@/lib/catalog/server';
import { processOutbox } from '@/lib/notifications/server';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Backstop: reruns every background handler over rows still waiting. Later milestones add theirs here. */
export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  return Response.json({ outboxSent: await processOutbox(), catalogProcessed: await sweepCatalog(3) });
}
