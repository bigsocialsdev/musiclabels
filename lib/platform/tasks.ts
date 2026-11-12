import 'server-only';
import { after } from 'next/server';
import { getEnv } from './env';
import { safeEqual } from './crypto';
import { errorMessage, log } from './log';

/**
 * Background work has no queue: the row's state is the work item. After the transaction that
 * created the state commits, call `kick` to run the handler for that row once the response is
 * sent. A cron sweep reruns the same (idempotent, row-claiming) handler for anything left over.
 */
export function kick(name: string, handler: () => Promise<unknown>): void {
  after(async () => {
    try {
      await handler();
    } catch (e) {
      log.error('background handler failed', { handler: name, error: errorMessage(e) });
    }
  });
}

/** Returns a 401 Response when the secret is missing or wrong, otherwise null. */
export function rejectUnlessAuthorized(req: Request, kind: 'cron' | 'task'): Response | null {
  const env = getEnv();
  const given =
    kind === 'cron'
      ? (req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '') // Vercel Cron sends this
      : (req.headers.get('x-task-secret') ?? '');
  const expected = kind === 'cron' ? env.CRON_SECRET : env.TASKS_SECRET;
  return safeEqual(given, expected) ? null : new Response('Unauthorized', { status: 401 });
}
