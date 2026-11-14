/**
 * Development seed: the reference data (scripts/seed-reference.ts) plus the private Storage buckets. Idempotent; safe to re-run.
 * Run with: npm run seed:dev   (needs DATABASE_URL and the Supabase URL + service-role key for buckets)
 *
 * The legal texts are PLACEHOLDERS for local development only. Real texts come from the lawyer ([Lawyer] in PLAN)
 * and are published through the superadmin screen, never from this script in production.
 */
import { getDb, closeDb } from '@/lib/platform/db';
import { BUCKETS } from '@/lib/platform/storage';
import { getSupabaseAdmin } from '@/lib/platform/supabase';
import { seedReference } from './seed-reference';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:dev refuses to run in production');
  await seedReference(getDb());

  const storage = getSupabaseAdmin().storage;
  for (const name of Object.values(BUCKETS)) {
    const { error } = await storage.createBucket(name, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`bucket ${name}: ${error.message}`);
  }
  console.log('seeded: genres, moods, placeholder legal documents, license terms, price book, buckets');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
