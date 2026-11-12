/**
 * Development seed: genre/mood lists, placeholder legal documents (so the acceptance gate and the seller
 * agreement guard can pass locally) and the private Storage buckets. Idempotent; safe to re-run.
 * Run with: npm run seed:dev   (needs DATABASE_URL and, for buckets, the Supabase URL + service-role key)
 *
 * The legal texts are PLACEHOLDERS for local development only. Real texts come from the lawyer ([Lawyer] in PLAN)
 * and are published through the superadmin screen, never from this script in production.
 */
import { createHash } from 'node:crypto';
import { legalDocuments, genres, moods } from '@/db/schema';
import { getDb, closeDb } from '@/lib/platform/db';
import { LEGAL_KINDS } from '@/lib/legal';
import { BUCKETS } from '@/lib/platform/storage';
import { getSupabaseAdmin } from '@/lib/platform/supabase';

const GENRES = ['Bollywood', 'Punjabi pop', 'Indie pop', 'Hip hop', 'Electronic', 'Lo-fi', 'Rock', 'Classical fusion', 'Devotional', 'Cinematic'];
const MOODS = ['Energetic', 'Romantic', 'Chill', 'Emotional', 'Uplifting', 'Dark', 'Festive', 'Nostalgic'];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:dev refuses to run in production');
  const db = getDb();

  await db.insert(genres).values(GENRES.map((name) => ({ name }))).onConflictDoNothing();
  await db.insert(moods).values(MOODS.map((name) => ({ name }))).onConflictDoNothing();

  for (const kind of LEGAL_KINDS) {
    const body = `DEV PLACEHOLDER for ${kind}. Not legal text.`;
    await db
      .insert(legalDocuments)
      .values({ kind, version: 1, bodyMarkdown: body, sha256: createHash('sha256').update(body).digest('hex'), effectiveAt: new Date() })
      .onConflictDoNothing();
  }

  const storage = getSupabaseAdmin().storage;
  for (const name of Object.values(BUCKETS)) {
    const { error } = await storage.createBucket(name, { public: false });
    if (error && !/already exists/i.test(error.message)) throw new Error(`bucket ${name}: ${error.message}`);
  }
  console.log('seeded: genres, moods, placeholder legal documents, buckets');
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
