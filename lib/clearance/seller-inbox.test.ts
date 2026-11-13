import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { auditLog, clearanceRequests, memberships } from '@/db/schema';
import { OrgAccessError } from '@/lib/identity';
import { closeDb, getDb } from '@/lib/platform/db';
import { sale, setupCommerce } from '@/tests/commerce';
import { makeSeller, makeUser } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { ClearanceInboxError, dispatchClearance, listSellerClearance, respondAsSeller } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const actorOf = (s: { owner: { userId: string }; orgId: string }) => ({ userId: s.owner.userId, orgId: s.orgId });
const err = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

/** A class B sale for the seller with its clearance request already sent. */
async function sentRequest(seller: { orgId: string }) {
  const s = await sale(db, gw, store, { sellerOrgId: seller.orgId, clearanceClass: 'B' });
  await dispatchClearance(db, { licenseId: s.licenseId! });
  const [req] = await db.select().from(clearanceRequests).where(eq(clearanceRequests.licenseId, s.licenseId!));
  expect(req!.status).toBe('sent');
  return req!.id;
}

describe('the seller’s clearance inbox', () => {
  it('lists only the own org’s requests, open ones first, and refuses a non-member', async () => {
    const mine = await makeSeller(db);
    const other = await makeSeller(db);
    const answered = await sentRequest(mine);
    const open = await sentRequest(mine);
    const theirs = await sentRequest(other);
    await respondAsSeller(db, actorOf(mine), answered, { outcome: 'released' });

    const rows = await listSellerClearance(db, actorOf(mine));
    expect(rows.map((r) => r.id)).toEqual([open, answered]);
    expect(rows[0]).toMatchObject({ status: 'sent', awaitingSeller: true, trackTitle: 'Test Track' });
    expect(rows[0]!.what).toContain('youtube channel');
    expect(rows[1]).toMatchObject({ status: 'completed', awaitingSeller: false });
    expect(rows.map((r) => r.id)).not.toContain(theirs);
    expect(JSON.stringify(rows)).not.toMatch(/respond_token|respondToken/i); // no way to read or reuse the emailed link
    expect(await err(listSellerClearance(db, { userId: (await makeUser(db)).userId, orgId: mine.orgId }))).toBeInstanceOf(OrgAccessError);
  });

  it('keeps open requests first even when the limit would otherwise cut them off', async () => {
    const seller = await makeSeller(db);
    const open = await sentRequest(seller); // oldest
    const answered = [await sentRequest(seller), await sentRequest(seller)];
    for (const id of answered) await respondAsSeller(db, actorOf(seller), id, { outcome: 'released' });
    expect((await listSellerClearance(db, actorOf(seller), { limit: 1 })).map((r) => r.id)).toEqual([open]);
  });

  it('the owner answers: released or declined, recorded once, audited by user, link cleared', async () => {
    const seller = await makeSeller(db);
    const released = await sentRequest(seller);
    const declined = await sentRequest(seller);
    expect(await respondAsSeller(db, actorOf(seller), released, { outcome: 'released', note: 'Released on YouTube Studio' }, '203.0.113.7')).toEqual({ ok: true, outcome: 'released' });
    expect(await respondAsSeller(db, actorOf(seller), declined, { outcome: 'declined' })).toEqual({ ok: true, outcome: 'declined' });

    const [a] = await db.select().from(clearanceRequests).where(eq(clearanceRequests.id, released));
    expect(a).toMatchObject({ status: 'completed', sellerNote: 'Released on YouTube Studio', respondTokenHash: null });
    expect((await db.select().from(clearanceRequests).where(eq(clearanceRequests.id, declined)))[0]!.status).toBe('failed');
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, released), eq(auditLog.action, 'clearance.complete')));
    expect(audit).toMatchObject({ actorUserId: seller.owner.userId });

    expect(await respondAsSeller(db, actorOf(seller), released, { outcome: 'declined' })).toEqual({ ok: false, reason: 'not_awaiting' }); // answered once
    expect((await db.select().from(clearanceRequests).where(eq(clearanceRequests.id, released)))[0]!.status).toBe('completed');
  });

  it('another org, a non-owner and bad input cannot answer', async () => {
    const seller = await makeSeller(db);
    const other = await makeSeller(db);
    const id = await sentRequest(seller);
    expect(await respondAsSeller(db, actorOf(other), id, { outcome: 'released' })).toEqual({ ok: false, reason: 'not_found' }); // not theirs
    expect(await err(respondAsSeller(db, { userId: (await makeUser(db)).userId, orgId: seller.orgId }, id, { outcome: 'released' }))).toBeInstanceOf(OrgAccessError); // not a member
    const member = await makeUser(db);
    await db.insert(memberships).values({ userId: member.userId, orgId: seller.orgId, role: 'member' });
    expect(await err(respondAsSeller(db, { userId: member.userId, orgId: seller.orgId }, id, { outcome: 'released' }))).toBeInstanceOf(ClearanceInboxError); // a member who is not the owner
    expect((await listSellerClearance(db, { userId: member.userId, orgId: seller.orgId })).map((r) => r.id)).toEqual([id]); // but they can look
    expect(await err(respondAsSeller(db, actorOf(seller), id, { outcome: 'maybe' }))).not.toBeNull();
    expect((await db.select().from(clearanceRequests).where(eq(clearanceRequests.id, id)))[0]!.status).toBe('sent');
  });
});
