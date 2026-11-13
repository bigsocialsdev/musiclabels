import { cleanupRateLimits } from '@/lib/platform/ratelimit';
import { runCron } from '../run';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => runCron(req, 'rate-limit-cleanup', { deleted: () => cleanupRateLimits() });
