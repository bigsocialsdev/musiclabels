import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { royaltyPaise } from '@/lib/ledger';
import { closeDb, getDb } from '@/lib/platform/db';
import { allocateDocumentNumber, computeGst, financialYear, formatDocumentNumber, isValidGstin, placeOfSupply } from './server';

afterAll(closeDb);
const db = getDb();

describe('GST computation (PLAN 8.2)', () => {
  const at = (taxablePaise: number, pos: string) => computeGst({ taxablePaise, gstRateBps: 1800, supplierStateCode: '27', placeOfSupplyState: pos });

  it.each([
    // taxable, place of supply, cgst, sgst, igst, total
    [100_000, '27', 9_000, 9_000, 0, 118_000],
    [100_000, '29', 0, 0, 18_000, 118_000],
    [49_900, '27', 4_491, 4_491, 0, 58_882],
    [49_900, '07', 0, 0, 8_982, 58_882],
    [25, '27', 2, 2, 0, 29], // 2.25 each rounds down
    [25, '33', 0, 0, 5, 30], // 4.5 rounds half up
    [50, '27', 5, 5, 0, 60], // 4.5 each rounds half up, per component
    [1, '27', 0, 0, 0, 1],
    [99_999_999, '36', 0, 0, 18_000_000, 117_999_999], // 17,999,999.82 rounds up
  ])('taxable %i to state %s → CGST %i, SGST %i, IGST %i, total %i', (taxable, pos, cgst, sgst, igst, total) => {
    expect(at(taxable, pos)).toMatchObject({ cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: total, intraState: pos === '27' });
  });

  it('rejects non-integer or non-positive taxable values', () => {
    expect(() => at(10.5, '27')).toThrow();
    expect(() => at(0, '27')).toThrow();
  });

  it('place of supply is the GSTIN state when given, else the billing state', () => {
    expect(placeOfSupply('29AAACB1234C1Z5', '27')).toBe('29');
    expect(placeOfSupply(null, '27')).toBe('27');
  });

  it('validates GSTIN format, state and check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false); // wrong check char
    expect(isValidGstin('99AAPFU0939F1ZV')).toBe(false); // no such state
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
  });
});

describe('numbering', () => {
  it('financial year follows the IST calendar (April to March)', () => {
    expect(financialYear(new Date('2027-03-31T18:29:59Z'))).toBe('2026-27'); // 23:59:59 IST, 31 March
    expect(financialYear(new Date('2027-03-31T18:30:00Z'))).toBe('2027-28'); // 00:00 IST, 1 April
    expect(financialYear(new Date('2099-12-31T00:00:00Z'))).toBe('2099-00');
  });

  it('document numbers are at most 16 characters', () => {
    expect(formatDocumentNumber('invoice', '2026-27', 123)).toBe('MRM/26-27/000123');
    expect(formatDocumentNumber('credit_note', '2026-27', 999_999)).toHaveLength(16);
    expect(() => formatDocumentNumber('invoice', '2026-27', 1_000_000)).toThrow();
  });

  const testFy = () => `${3000 + Math.floor(Math.random() * 6000)}-01`; // isolated series per run

  it('allocation is gap-free: a rolled-back transaction returns its number', async () => {
    const fy = testFy();
    const first = await db.transaction((tx) => allocateDocumentNumber(tx, 'invoice', fy));
    await db
      .transaction(async (tx) => {
        await allocateDocumentNumber(tx, 'invoice', fy);
        tx.rollback();
      })
      .catch(() => {});
    const next = await db.transaction((tx) => allocateDocumentNumber(tx, 'invoice', fy));
    expect(Number(next.slice(-6))).toBe(Number(first.slice(-6)) + 1);
  });

  it('concurrent allocations are unique and consecutive; series are independent', async () => {
    const fy = testFy();
    const nums = await Promise.all(Array.from({ length: 12 }, () => db.transaction((tx) => allocateDocumentNumber(tx, 'invoice', fy))));
    expect(nums.map((n) => Number(n.slice(-6))).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(await db.transaction((tx) => allocateDocumentNumber(tx, 'credit_note', fy))).toMatch(/^MCN\/.+\/000001$/);
  });

  it('the counter can only step forward by one', async () => {
    const fy = testFy();
    await db.transaction((tx) => allocateDocumentNumber(tx, 'invoice', fy));
    const err = await db.execute(sql`UPDATE invoice_series SET next_number = next_number + 5 WHERE fy = ${fy}`).then(() => null, (e: Error) => (e.cause as Error) ?? e);
    expect(err?.message).toMatch(/advance by one/);
  });
});

describe('royalty', () => {
  it('is the taxable value × contract rate, rounded down', () => {
    expect(royaltyPaise(49_900, 7000)).toBe(34_930);
    expect(royaltyPaise(99_999, 7_333)).toBe(73_329); // 73_329.2667
    expect(royaltyPaise(1, 9_999)).toBe(0);
  });
});
