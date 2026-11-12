import { cleanupRateLimits } from '@/lib/platform/ratelimit';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  return Response.json({ deleted: await cleanupRateLimits() });
}
