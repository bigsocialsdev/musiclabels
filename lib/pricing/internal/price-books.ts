import { and, desc, eq, sql } from 'drizzle-orm';
import { priceBookEntries, priceBooks } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import type { DbOrTx } from '@/lib/platform/db';
import type { PriceLevel } from '@/lib/catalog';
import type { Tier } from '@/lib/licensing';
import { priceBookEntriesSchema, type Price, type PriceBookEntryInput } from '../index';

/** Creates the next draft version with its full grid. The grid is append-only: a price change is a new book. */
export async function createPriceBook(db: DbOrTx, admin: AdminContext, entries: PriceBookEntryInput[], ip?: string | null) {
  requirePermission(admin, 'verification');
  const grid = priceBookEntriesSchema.parse(entries);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('price_book:version'))`);
    const [latest] = await tx.select({ version: priceBooks.version }).from(priceBooks).orderBy(desc(priceBooks.version)).limit(1);
    const [book] = await tx
      .insert(priceBooks)
      .values({ version: (latest?.version ?? 0) + 1, createdBy: admin.userId })
      .returning({ id: priceBooks.id, version: priceBooks.version });
    await tx.insert(priceBookEntries).values(grid.map((e) => ({ ...e, priceBookId: book!.id })));
    await writeAudit(tx, {
      actorUserId: admin.userId,
      action: 'price_book.create',
      entityType: 'price_book',
      entityId: book!.id,
      after: { version: book!.version, entries: grid },
      ip,
    });
    return book!;
  });
}

export type ActivateResult = { ok: true; retiredId: string | null } | { ok: false; reason: 'not_found' | 'not_draft'; status?: string };

/** draft → active; the previously active book → retired. Serialised so exactly one book is active. */
export async function activatePriceBook(db: DbOrTx, admin: AdminContext, priceBookId: string, ip?: string | null): Promise<ActivateResult> {
  requirePermission(admin, 'verification');
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('price_book:activate'))`);
    const [book] = await tx.select({ status: priceBooks.status }).from(priceBooks).where(eq(priceBooks.id, priceBookId));
    if (!book) return { ok: false, reason: 'not_found' } as const;
    if (book.status !== 'draft') return { ok: false, reason: 'not_draft', status: book.status } as const;

    const [retired] = await tx
      .update(priceBooks)
      .set({ status: 'retired' })
      .where(eq(priceBooks.status, 'active'))
      .returning({ id: priceBooks.id });
    const activated = await tx
      .update(priceBooks)
      .set({ status: 'active', effectiveAt: new Date() })
      .where(and(eq(priceBooks.id, priceBookId), eq(priceBooks.status, 'draft')))
      .returning({ id: priceBooks.id });
    if (activated.length === 0) throw new Error('price book changed under the activation lock');
    await writeAudit(tx, {
      actorUserId: admin.userId,
      action: 'price_book.activate',
      entityType: 'price_book',
      entityId: priceBookId,
      before: { status: 'draft', activeBookId: retired?.id ?? null },
      after: { status: 'active' },
      ip,
    });
    return { ok: true, retiredId: retired?.id ?? null } as const;
  });
}

/** Price for a level × tier from the active book, or null when nothing is active. */
export async function getActivePrice(db: DbOrTx, priceLevel: PriceLevel, tier: Tier): Promise<Price | null> {
  const [row] = await db
    .select({ priceBookId: priceBooks.id, priceBookVersion: priceBooks.version, amountPaise: priceBookEntries.amountPaise })
    .from(priceBooks)
    .innerJoin(priceBookEntries, eq(priceBookEntries.priceBookId, priceBooks.id))
    .where(and(eq(priceBooks.status, 'active'), eq(priceBookEntries.priceLevel, priceLevel), eq(priceBookEntries.tier, tier)));
  return row ?? null;
}
