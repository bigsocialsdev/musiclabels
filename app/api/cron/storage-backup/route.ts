import { getDb } from '@/lib/platform/db';
import { r2OffsiteStore } from '@/lib/platform/offsite-r2';
import { supabaseObjectStore } from '@/lib/platform/storage';
import { backupStorage } from '@/lib/platform/storage-backup';
import { runCron } from '../run';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Daily (PLAN §5.8, F11): copies new and changed Storage objects to the off-site bucket and records each in the manifest. */
export const GET = (req: Request) => runCron(req, 'storage-backup', { storage: () => backupStorage(getDb(), { store: supabaseObjectStore, offsite: r2OffsiteStore() }) });
