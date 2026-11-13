import { asc, desc, eq } from 'drizzle-orm';
import { priceBookEntries, priceBooks } from '@/db/schema';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';

export type PriceBookView = { id: string; version: number; status: string; effectiveAt: Date | null; createdAt: Date; entries: { priceLevel: string; tier: string; amountPaise: number }[] };

/** Price book versions with their full grid, newest first (PLAN §9: Catalog admin). The grid is append-only: a price change is a new book. */
export async function listPriceBooks(db: DbOrTx, admin: AdminContext): Promise<PriceBookView[]> {
  requirePermission(admin, 'verification');
  const books = await db.select().from(priceBooks).orderBy(desc(priceBooks.version)).limit(20);
  const out: PriceBookView[] = [];
  for (const b of books) {
    const entries = await db
      .select({ priceLevel: priceBookEntries.priceLevel, tier: priceBookEntries.tier, amountPaise: priceBookEntries.amountPaise })
      .from(priceBookEntries)
      .where(eq(priceBookEntries.priceBookId, b.id))
      .orderBy(asc(priceBookEntries.priceLevel), asc(priceBookEntries.tier));
    out.push({ id: b.id, version: b.version, status: b.status, effectiveAt: b.effectiveAt, createdAt: b.createdAt, entries });
  }
  return out;
}
