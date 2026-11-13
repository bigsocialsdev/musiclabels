import { enqueueOpsAlert } from '@/lib/notifications/server';
import { getDb } from '@/lib/platform/db';
import { errorMessage, log } from '@/lib/platform/log';
import { consume } from '@/lib/platform/ratelimit';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

const DAY_SECONDS = 86_400;

/**
 * Shared shell of every cron route: checks the secret, runs each part in order with failures isolated (one failed
 * part never stops the rest), and when anything failed answers 500 (so Vercel shows the run as failed) and raises one
 * ops alert per cron per day (PLAN §10), so a broken job is noticed rather than only logged.
 */
export async function runCron(req: Request, name: string, parts: Record<string, () => Promise<unknown>>): Promise<Response> {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [part, job] of Object.entries(parts)) {
    try {
      results[part] = await job();
    } catch (e) {
      errors[part] = errorMessage(e).slice(0, 300);
      results[part] = { error: errors[part] };
      log.error('cron part failed', { cron: name, part, error: errors[part] });
    }
  }
  if (Object.keys(errors).length === 0) return Response.json(results);
  const db = getDb();
  if (await consume(`alert:cron:${name}`, { capacity: 1, refillPerSecond: 1 / DAY_SECONDS }, db)) {
    await enqueueOpsAlert(db, 'cron_failure', `Cron job ${name} failed`, { cron: name, errors });
  }
  return Response.json(results, { status: 500 });
}
