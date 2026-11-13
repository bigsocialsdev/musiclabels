import { runPayoutsCron } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { supabaseObjectStore } from '@/lib/platform/storage';
import { runCron } from '../run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (PLAN §5.8): computes the previous month's batch on the configured day; fills missing statements. */
export const GET = (req: Request) => runCron(req, 'payouts', { payouts: () => runPayoutsCron(getDb(), supabaseObjectStore) });
