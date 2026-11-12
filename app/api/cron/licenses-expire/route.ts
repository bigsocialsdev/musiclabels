import { expireLicenses } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: paid-ad licenses past ends_at → expired (PLAN §5.8). Reads already treat them as expired. */
export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  return Response.json({ expired: await expireLicenses(getDb()) });
}
