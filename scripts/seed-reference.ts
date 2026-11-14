import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { legalDocuments, genres, licenseTermsVersions, moods, priceBookEntries, priceBooks, users } from '@/db/schema';
import { PRICE_LEVELS } from '@/lib/catalog';
import type { Db } from '@/lib/platform/db';
import { LEGAL_KINDS } from '@/lib/legal';
import { TIERS } from '@/lib/licensing';

/**
 * Reference data every environment with a database needs to quote and sell a track: genre and mood lists, placeholder
 * legal documents (so the acceptance gate and the seller agreement guard can pass), default license terms per tier and a
 * placeholder price book. Idempotent. Shared by seed:dev and seed:e2e. PLACEHOLDER legal texts: never for production.
 */
const GENRES = ['Bollywood', 'Punjabi pop', 'Indie pop', 'Hip hop', 'Electronic', 'Lo-fi', 'Rock', 'Classical fusion', 'Devotional', 'Cinematic'];
const SEED_USER_ID = '00000000-0000-7000-8000-000000000001';
const MOODS = ['Energetic', 'Romantic', 'Chill', 'Emotional', 'Uplifting', 'Dark', 'Festive', 'Nostalgic'];

export async function seedReference(db: Db) {
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
}
