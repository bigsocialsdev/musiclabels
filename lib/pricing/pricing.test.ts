import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, priceBooks } from '@/db/schema';
import { PRICE_LEVELS } from '@/lib/catalog';
import { TIERS } from '@/lib/licensing';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeUser } from '@/tests/factories';
import { activatePriceBook, createPriceBook, getActivePrice, type PriceBookEntryInput } from './server';

afterAll(closeDb);
const db = getDb();

const admin = async (permissions: ('verification' | 'finance')[] = ['verification']) => {
  const s = await makeUser(db, { admin: permissions, aal: 'aal2' });
  return { userId: s.userId, permissions };
};
const grid = (base: number): PriceBookEntryInput[] =>
  PRICE_LEVELS.flatMap((priceLevel, i) => TIERS.map((tier, j) => ({ priceLevel, tier, amountPaise: base + i * 1000 + j * 100 })));
const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};

describe('price books', () => {
  it('creates a draft with a complete grid and an audit row; needs the verification permission', async () => {
    const a = await admin();
    const book = await createPriceBook(db, a, grid(49_900));
    const [row] = await db.select().from(priceBooks).where(eq(priceBooks.id, book.id));
    expect(row).toMatchObject({ status: 'draft', createdBy: a.userId, effectiveAt: null });
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, book.id), eq(auditLog.action, 'price_book.create')));
    expect(audits).toHaveLength(1);
    await expect(createPriceBook(db, await admin(['finance']), grid(1))).rejects.toThrow(/verification/);
  });

  it('rejects incomplete, duplicated or non-integer grids', async () => {
    const a = await admin();
    await expect(createPriceBook(db, a, grid(100).slice(1))).rejects.toThrow(/every price level/);
    const dup = grid(100);
    dup[1] = { ...dup[0]! };
    await expect(createPriceBook(db, a, dup)).rejects.toThrow(/duplicate/);
    const frac = grid(100);
    frac[0] = { ...frac[0]!, amountPaise: 499.5 };
    await expect(createPriceBook(db, a, frac)).rejects.toThrow();
    const neg = grid(100);
    neg[0] = { ...neg[0]!, amountPaise: -1 };
    await expect(createPriceBook(db, a, neg)).rejects.toThrow();
  });

  it('activation retires the previous book and moves prices; only drafts activate', async () => {
    const a = await admin();
    const first = await createPriceBook(db, a, grid(10_000));
    expect((await activatePriceBook(db, a, first.id)).ok).toBe(true);
    expect(await getActivePrice(db, 'L2', 'paid_ad')).toMatchObject({ priceBookId: first.id, amountPaise: 10_000 + 1000 + 200 });

    const second = await createPriceBook(db, a, grid(20_000));
    expect(await activatePriceBook(db, a, second.id)).toEqual({ ok: true, retiredId: first.id });
    expect(await getActivePrice(db, 'L2', 'paid_ad')).toMatchObject({ priceBookId: second.id, amountPaise: 20_000 + 1000 + 200 });
    const [old] = await db.select({ status: priceBooks.status }).from(priceBooks).where(eq(priceBooks.id, first.id));
    expect(old!.status).toBe('retired');

    expect(await activatePriceBook(db, a, first.id)).toEqual({ ok: false, reason: 'not_draft', status: 'retired' });
    expect(await activatePriceBook(db, a, second.id)).toEqual({ ok: false, reason: 'not_draft', status: 'active' });
  });

  it('concurrent activations leave exactly one active book', async () => {
    const a = await admin();
    const books = await Promise.all([1, 2, 3, 4].map((i) => createPriceBook(db, a, grid(i * 30_000))));
    const results = await Promise.all(books.map((b) => activatePriceBook(db, a, b.id)));
    expect(results.every((r) => r.ok)).toBe(true);
    const active = await db.select({ id: priceBooks.id }).from(priceBooks).where(eq(priceBooks.status, 'active'));
    expect(active).toHaveLength(1);
  });

  it('grids are append-only and books are never deleted', async () => {
    const a = await admin();
    const book = await createPriceBook(db, a, grid(5_000));
    expect(await dbMessage(sql`UPDATE price_book_entries SET amount_paise = 1 WHERE price_book_id = ${book.id}`)).toMatch(/append-only/);
    expect(await dbMessage(sql`DELETE FROM price_book_entries WHERE price_book_id = ${book.id}`)).toMatch(/append-only/);
    expect(await dbMessage(sql`DELETE FROM price_books WHERE id = ${book.id}`)).toMatch(/not allowed/);
    expect(await dbMessage(sql`INSERT INTO price_books (id, version, status, created_by) VALUES (gen_random_uuid(), 999999, 'active', ${a.userId})`)).toMatch(
      /price_books_one_active_idx|duplicate key/,
    );
  });
});
