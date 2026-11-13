/**
 * Restore drill (PLAN §10, F11): checks a restored database and the off-site Storage copy, and prints a result block
 * to paste into docs/restore-drill.md. It never writes to the database it is pointed at; its only write is
 * `--restore-storage`, which uploads into the Storage project named by --target-host.
 *
 * The restore itself is done by hand first (docs/restore-drill.md): Supabase backup or point-in-time recovery into a
 * new project, then this script with DATABASE_URL set to the RESTORED database (never production):
 *
 *   npm run restore:drill -- --sample 200            database checks + 200 random off-site objects read back
 *   npm run restore:drill -- --db-only               database checks only (no off-site credentials needed)
 *   npm run restore:drill -- --storage-only --all    every object in the manifest
 *   npm run restore:drill -- --restore-storage --target-host <ref>.supabase.co --all
 *                                                    puts the off-site copies back into the RESTORED Supabase project
 *                                                    (NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY of that project) and reads them back
 *
 * Needs the BACKUP_S3_* settings for the storage part. Exit code 1 when any check fails.
 */
import { parseArgs } from 'node:util';
import { closeDb, getDb } from '@/lib/platform/db';
import { r2OffsiteStore } from '@/lib/platform/offsite-r2';
import { supabaseObjectStore } from '@/lib/platform/storage';
import { checkDatabase, checkStorageRestore, journalEntryCount, restoreChecks, restoreStorage, storageChecks, type Check } from './restore-drill-checks';

const { values } = parseArgs({
  options: { 'db-only': { type: 'boolean' }, 'storage-only': { type: 'boolean' }, 'restore-storage': { type: 'boolean' }, 'target-host': { type: 'string' }, sample: { type: 'string' }, all: { type: 'boolean' } },
});

const timed = async <T>(label: string, f: () => Promise<T>): Promise<{ value: T; seconds: number; label: string }> => {
  const t = Date.now();
  const value = await f();
  return { value, seconds: Math.round((Date.now() - t) / 100) / 10, label };
};

async function main() {
  const db = getDb();
  const sample = values.all ? 0 : Number(values.sample ?? 100);
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://unset').hostname;
  const results: { phase: string; seconds: number; checks: Check[] }[] = [];

  if (values['restore-storage']) {
    if (!values.all && !values.sample) throw new Error('--restore-storage needs --all (a real recovery) or --sample N (a rehearsal)');
    // The one write this script can make: refuse unless the operator names the Storage project it is about to fill, so a
    // production URL left in the environment cannot be overwritten by mistake.
    const target = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://unset').hostname;
    if (values['target-host'] !== target) throw new Error(`--target-host must equal the host of NEXT_PUBLIC_SUPABASE_URL (${target}); check you are pointing at the restored project`);
    const r = await timed('restore', async () => restoreChecks(await restoreStorage(db, r2OffsiteStore(), supabaseObjectStore, { sample })));
    results.push({ phase: 'Storage restore into ' + target, seconds: r.seconds, checks: r.value });
  }
  if (!values['storage-only'] && !values['restore-storage']) {
    const r = await timed('database', () => checkDatabase(db, { expectedMigrations: journalEntryCount(), licenseSample: sample }));
    results.push({ phase: 'Database', seconds: r.seconds, checks: r.value });
  }
  if (!values['db-only'] && !values['restore-storage']) {
    const r = await timed('storage', async () => storageChecks(await checkStorageRestore(db, r2OffsiteStore(), { sample })));
    results.push({ phase: 'Off-site Storage', seconds: r.seconds, checks: r.value });
  }

  console.log(`### Result (${new Date().toISOString()}, database host ${host})\n`);
  for (const r of results) {
    console.log(`**${r.phase}** (${r.seconds} s)\n`);
    for (const c of r.checks) console.log(`- ${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
    console.log('');
  }
  const failed = results.flatMap((r) => r.checks).filter((c) => !c.ok);
  console.log(failed.length === 0 ? 'All checks passed.' : `${failed.length} check(s) failed.`);
  await closeDb();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await closeDb().catch(() => {});
  process.exit(1);
});
