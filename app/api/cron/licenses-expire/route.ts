import { expireLicenses } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { runCron } from '../run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily: paid-ad licenses past ends_at → expired (PLAN §5.8). Reads already treat them as expired. */
export const GET = (req: Request) => runCron(req, 'licenses-expire', { expired: () => expireLicenses(getDb()) });
