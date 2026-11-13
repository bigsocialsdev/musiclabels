import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payoutBatches, payouts } from '@/db/schema';
import { OrgAccessError } from '@/lib/identity';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/platform/db';
import { setupCommerce, sale } from '@/tests/commerce';
import { makeSeller, makeUser } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { getSellerBalances, listSellerLedger } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
const DAY = 86_400_000;

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const actorOf = (s: { owner: { userId: string }; orgId: string }) => ({ userId: s.owner.userId, orgId: s.orgId });
const err = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

describe('what a seller sees of their money', () => {
  it('lists only the own org’s entries with the sale details, and never the buyer', async () => {
    const mine = await makeSeller(db);
    const other = await makeSeller(db);
    const s = await sale(db, gw, store, { sellerOrgId: mine.orgId });
    await sale(db, gw, store, { sellerOrgId: other.orgId });

    const rows = await listSellerLedger(db, actorOf(mine));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'sale_royalty', amountPaise: 70_000, status: 'on_hold', trackTitle: 'Test Track', tier: 'creator', taxablePaise: 100_000 });
    expect(rows[0]!.availableAt.getTime() - rows[0]!.at.getTime()).toBeGreaterThan(29 * DAY); // 30-day hold
    const json = JSON.stringify(rows);
    expect(json).not.toContain('Buyer Media LLP'); // who bought is not part of the seller's view
    expect(json).not.toContain(s.buyer.orgId);
    expect(json).not.toContain(s.orderId);
    expect(await listSellerLedger(db, actorOf(other))).toHaveLength(1); // their own only
  });

  it('refuses someone who is not a member of the org they name', async () => {
    const seller = await makeSeller(db);
    const stranger = await makeUser(db);
    expect(await err(listSellerLedger(db, { userId: stranger.userId, orgId: seller.orgId }))).toBeInstanceOf(OrgAccessError);
    expect(await err(getSellerBalances(db, { userId: stranger.userId, orgId: seller.orgId }))).toBeInstanceOf(OrgAccessError);
  });

  it('splits what is on hold from what has matured', async () => {
    const seller = await makeSeller(db);
    await sale(db, gw, store, { sellerOrgId: seller.orgId }); // today: on hold
    await sale(db, gw, store, { sellerOrgId: seller.orgId, paidAt: new Date(Date.now() - 40 * DAY) }); // matured
    expect(await getSellerBalances(db, actorOf(seller))).toEqual({ availablePaise: 70_000, inPayoutPaise: 0, heldPaise: 70_000 });
    expect(await getSellerBalances(db, actorOf(await makeSeller(db)))).toEqual({ availablePaise: 0, inPayoutPaise: 0, heldPaise: 0 });
    expect((await listSellerLedger(db, actorOf(seller))).map((r) => r.status).sort()).toEqual(['matured', 'on_hold']);
  });

  it('moves matured money out of "available" while a payout run holds it, and back if the payout fails', async () => {
    const seller = await makeSeller(db);
    await sale(db, gw, store, { sellerOrgId: seller.orgId, paidAt: new Date(Date.now() - 40 * DAY) });
    const [batch] = await db.insert(payoutBatches).values({ period: '1972-01', cutoffAt: new Date('1972-01-28T18:30:00Z'), status: 'completed' }).onConflictDoNothing().returning({ id: payoutBatches.id });
    const batchId = batch?.id ?? (await db.select({ id: payoutBatches.id }).from(payoutBatches).where(eq(payoutBatches.period, '1972-01')))[0]!.id;
    const [p] = await db.insert(payouts).values({ batchId, sellerOrgId: seller.orgId, royaltyBasePaise: 70_000, tdsPaise: 0, sellerGstPaise: 0, rcmGstPaise: 0, netPaise: 70_000, rail: 'bank_file', status: 'processing' }).returning({ id: payouts.id });
    expect(await getSellerBalances(db, actorOf(seller))).toEqual({ availablePaise: 0, inPayoutPaise: 70_000, heldPaise: 0 });
    await db.update(payouts).set({ status: 'failed' }).where(eq(payouts.id, p!.id)); // failures write no ledger entry (PLAN 5.6)
    expect(await getSellerBalances(db, actorOf(seller))).toEqual({ availablePaise: 70_000, inPayoutPaise: 0, heldPaise: 0 });
  });
});
