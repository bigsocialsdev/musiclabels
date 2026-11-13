import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { payoutBatches, payouts } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeSeller, makeUser } from '@/tests/factories';
import { PayoutReadError, listSellerPayouts, sellerStatementUrl } from './server';

// The signed-URL call needs a live Supabase Storage; everything else here is real Postgres.
vi.mock('@/lib/platform/storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/platform/storage')>()),
  createSignedDownloadUrl: async (bucket: string, key: string, _ttl: number, name?: string) => `https://storage.test/${bucket}/${key}?download=${name}`,
}));

afterAll(closeDb);
const db = getDb();
const actorOf = (s: { owner: { userId: string }; orgId: string }) => ({ userId: s.owner.userId, orgId: s.orgId });
const err = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

/** Completed batches far in the past, so they cannot interfere with the payout-run tests' period order. */
async function oldBatch(period: string): Promise<string> {
  const [existing] = await db.select({ id: payoutBatches.id }).from(payoutBatches).where(eq(payoutBatches.period, period));
  if (existing) return existing.id;
  const [b] = await db.insert(payoutBatches).values({ period, cutoffAt: new Date(`${period}-28T18:30:00Z`), status: 'completed' }).returning({ id: payoutBatches.id });
  return b!.id;
}

/** One payout line (a seller has at most one per batch, so tests pick the period). */
async function payoutFor(sellerOrgId: string, period = '1971-01', over: Partial<typeof payouts.$inferInsert> = {}) {
  const [p] = await db
    .insert(payouts)
    .values({ batchId: await oldBatch(period), sellerOrgId, royaltyBasePaise: 70_000, tdsPaise: 0, sellerGstPaise: 0, rcmGstPaise: 12_600, netPaise: 70_000, rail: 'bank_file', railRef: 'internal/ref.csv', status: 'paid', utr: 'UTR123', paidAt: new Date(), statementPdfKey: `statements/${period}/x.pdf`, ...over })
    .returning({ id: payouts.id });
  return p!.id;
}

describe('what a seller sees of their payouts', () => {
  it('lists only the own org’s payouts, without bank references or failure details', async () => {
    const mine = await makeSeller(db);
    const other = await makeSeller(db);
    const paid = await payoutFor(mine.orgId, '1971-01');
    const failed = await payoutFor(mine.orgId, '1971-02', { status: 'failed', utr: null, paidAt: null, failureReason: 'bank rejected: account closed', statementPdfKey: null });
    const theirs = await payoutFor(other.orgId, '1971-01');

    const rows = await listSellerPayouts(db, actorOf(mine));
    expect(rows.map((r) => r.id)).toEqual([failed, paid]); // newest period first
    expect(rows.map((r) => r.id)).not.toContain(theirs);
    expect(rows.find((r) => r.id === paid)).toMatchObject({ status: 'paid', utr: 'UTR123', hasStatement: true, royaltyBasePaise: 70_000, netPaise: 70_000 });
    expect(rows.find((r) => r.id === failed)).toMatchObject({ status: 'failed', utr: null, hasStatement: false });
    expect(JSON.stringify(rows)).not.toMatch(/internal\/ref\.csv|bank rejected|statements\//);
    expect(await err(listSellerPayouts(db, { userId: (await makeUser(db)).userId, orgId: mine.orgId }))).toBeInstanceOf(PayoutReadError);
  });

  it('gives the statement link only to the org that owns the paid payout', async () => {
    const mine = await makeSeller(db);
    const other = await makeSeller(db);
    const id = await payoutFor(mine.orgId, '1971-01');
    expect(await sellerStatementUrl(db, actorOf(mine), id)).toBe('https://storage.test/pdfs/statements/1971-01/x.pdf?download=payout-statement-1971-01.pdf');
    expect(await sellerStatementUrl(db, actorOf(other), id)).toBeNull(); // someone else's payout looks missing
    expect(await err(sellerStatementUrl(db, { userId: other.owner.userId, orgId: mine.orgId }, id))).toBeInstanceOf(PayoutReadError);

    expect(await sellerStatementUrl(db, actorOf(mine), await payoutFor(mine.orgId, '1971-02', { statementPdfKey: null }))).toBeNull(); // not generated yet
    expect(await sellerStatementUrl(db, actorOf(mine), await payoutFor(mine.orgId, '1971-03', { status: 'failed', utr: null, paidAt: null }))).toBeNull(); // only paid payouts
  });
});
