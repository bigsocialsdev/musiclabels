import { runPayoutsCron } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { supabaseObjectStore } from '@/lib/platform/storage';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (PLAN §5.8): computes the previous month's batch on the configured day; fills missing statements. */
export async function GET(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'cron');
  if (denied) return denied;
  return Response.json(await runPayoutsCron(getDb(), supabaseObjectStore));
}
