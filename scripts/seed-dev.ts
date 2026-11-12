/**
 * Development seed: genre/mood lists, placeholder legal documents (so the acceptance gate and the seller
 * agreement guard can pass locally), default license terms per tier, a placeholder price book (so tracks can be
 * quoted) and the private Storage buckets. Idempotent; safe to re-run.
 * Run with: npm run seed:dev   (needs DATABASE_URL and, for buckets, the Supabase URL + service-role key)
 *
 * The legal texts are PLACEHOLDERS for local development only. Real texts come from the lawyer ([Lawyer] in PLAN)
 * and are published through the superadmin screen, never from this script in production.
 */
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { legalDocuments, genres, licenseTermsVersions, moods, priceBookEntries, priceBooks, users } from '@/db/schema';
import { PRICE_LEVELS } from '@/lib/catalog';
import { getDb, closeDb } from '@/lib/platform/db';
import { LEGAL_KINDS } from '@/lib/legal';
import { TIERS } from '@/lib/licensing';
import { BUCKETS } from '@/lib/platform/storage';
import { getSupabaseAdmin } from '@/lib/platform/supabase';

const GENRES = ['Bollywood', 'Punjabi pop', 'Indie pop', 'Hip hop', 'Electronic', 'Lo-fi', 'Rock', 'Classical fusion', 'Devotional', 'Cinematic'];
const SEED_USER_ID = '00000000-0000-7000-8000-000000000001';
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

  // Tier rules per PLAN 6.1, pointing at the placeholder license texts above.
  for (const tier of TIERS) {
    const [existing] = await db.select({ id: licenseTermsVersions.id }).from(licenseTermsVersions).where(eq(licenseTermsVersions.tier, tier)).limit(1);
    if (existing) continue;
    const [text] = await db.select({ id: legalDocuments.id }).from(legalDocuments).where(and(eq(legalDocuments.kind, `license_${tier}`), eq(legalDocuments.version, 1)));
    await db.insert(licenseTermsVersions).values({
      tier,
      version: 1,
      termKind: tier === 'paid_ad' ? 'fixed_months' : 'perpetual',
      termMonths: tier === 'paid_ad' ? 12 : null,
      videoCap: { creator: 1, brand_organic: 3, paid_ad: null }[tier],
      maxChannels: 3,
      allowedPlatforms: ['youtube', 'instagram', 'facebook'],
      organicOnly: tier !== 'paid_ad',
      licenseTextDocumentId: text!.id,
      effectiveAt: new Date(),
    });
  }

  // DEV PLACEHOLDER prices (paise, GST-exclusive). Real prices are set by an admin as a new price book.
  const [active] = await db.select({ id: priceBooks.id }).from(priceBooks).where(eq(priceBooks.status, 'active'));
  if (!active) {
    await db.insert(users).values({ id: SEED_USER_ID, email: 'seed@dev.local', name: 'Dev seed' }).onConflictDoNothing();
    const [latest] = await db.select({ version: priceBooks.version }).from(priceBooks).orderBy(desc(priceBooks.version)).limit(1);
    const [book] = await db
      .insert(priceBooks)
      .values({ version: (latest?.version ?? 0) + 1, status: 'active', effectiveAt: new Date(), createdBy: SEED_USER_ID })
      .returning({ id: priceBooks.id });
    const base = { creator: 49_900, brand_organic: 299_900, paid_ad: 999_900 };
    await db.insert(priceBookEntries).values(
      PRICE_LEVELS.flatMap((priceLevel, i) => TIERS.map((tier) => ({ priceBookId: book!.id, priceLevel, tier, amountPaise: base[tier] * (i + 1) }))),
    );
  }

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
