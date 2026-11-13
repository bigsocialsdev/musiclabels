import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { creditNotes, invoices, licenses, memberships } from '@/db/schema';
import { buyerDocumentUrl } from '@/lib/certificates/server';
import { getVerifyView } from '@/lib/certificates/server';
import { listBuyerBilling } from '@/lib/invoicing/server';
import { OrgAccessError } from '@/lib/identity';
import { listBuyerOrgs, setVerifyFullName } from '@/lib/identity/server';
import { executeRefund, requestRefund } from '@/lib/orders/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { adminCtx, readyBuyer, sale, setupCommerce } from '@/tests/commerce';
import { makeUser } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { LICENSE_LIST_PAGE_SIZE, listBuyerLicenses } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const publicIdOf = async (licenseId: string) => (await db.select({ p: licenses.publicId }).from(licenses).where(eq(licenses.id, licenseId)))[0]!.p;

describe('the buyer license list', () => {
  it('shows only licenses bought by the user\'s own orgs, newest first', async () => {
    const buyer = await readyBuyer(db);
    const a = await sale(db, gw, store, { buyer });
    const b = await sale(db, gw, store, { buyer });
    const other = await sale(db, gw, store); // another buyer's license
    const list = await listBuyerLicenses(db, buyer.owner.userId);
    expect(list.licenses.map((l) => l.id)).toEqual([b.licenseId, a.licenseId]);
    expect(list.licenses.map((l) => l.id)).not.toContain(other.licenseId);
    expect(list.total).toBe(2);
    expect(list.licenses[0]).toMatchObject({ status: 'active', tier: 'creator' });
    // a user in no org sees nothing
    expect((await listBuyerLicenses(db, (await makeUser(db)).userId)).total).toBe(0);
  });

  it('includes licenses of every org the user belongs to, and loses them when the membership goes', async () => {
    const one = await readyBuyer(db);
    const two = await readyBuyer(db);
    const s1 = await sale(db, gw, store, { buyer: one });
    const s2 = await sale(db, gw, store, { buyer: two });
    await db.insert(memberships).values({ userId: one.owner.userId, orgId: two.orgId, role: 'member' });
    const ids = (await listBuyerLicenses(db, one.owner.userId)).licenses.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining([s1.licenseId, s2.licenseId]));
    await db.delete(memberships).where(and(eq(memberships.userId, one.owner.userId), eq(memberships.orgId, two.orgId)));
    expect((await listBuyerLicenses(db, one.owner.userId)).licenses.map((l) => l.id)).not.toContain(s2.licenseId);
  });

  it('filters by client name as plain text, case-insensitively, and offers the names to filter by', async () => {
    const agency = await readyBuyer(db, 'agency');
    const acme = await sale(db, gw, store, { buyer: agency, clientName: 'Acme Biscuits' });
    const zen = await sale(db, gw, store, { buyer: agency, clientName: 'Zen_Tea 100%' });
    const none = await sale(db, gw, store, { buyer: agency });
    const u = agency.owner.userId;
    expect((await listBuyerLicenses(db, u, { client: 'acme' })).licenses.map((l) => l.id)).toEqual([acme.licenseId]);
    expect((await listBuyerLicenses(db, u, { client: 'ZEN_TEA 100%' })).licenses.map((l) => l.id)).toEqual([zen.licenseId]);
    // wildcards in the input are literal: "%" and "_" must not match everything
    expect((await listBuyerLicenses(db, u, { client: '%' })).licenses.map((l) => l.id)).toEqual([zen.licenseId]);
    expect((await listBuyerLicenses(db, u, { client: 'Zen%Tea' })).total).toBe(0);
    expect((await listBuyerLicenses(db, u, { client: 'nobody' })).total).toBe(0);
    const all = await listBuyerLicenses(db, u);
    expect(all.licenses.map((l) => l.id)).toEqual(expect.arrayContaining([acme.licenseId, zen.licenseId, none.licenseId]));
    expect(all.clients).toEqual(['Acme Biscuits', 'Zen_Tea 100%']);
  });

  it('pages the list and reports an expired paid-ad license as expired', async () => {
    const buyer = await readyBuyer(db);
    for (let i = 0; i < 3; i++) await sale(db, gw, store, { buyer, tier: 'creator' });
    const p1 = await listBuyerLicenses(db, buyer.owner.userId, { page: 1, pageSize: 2 });
    const p2 = await listBuyerLicenses(db, buyer.owner.userId, { page: 2, pageSize: 2 });
    expect(p1.licenses).toHaveLength(2);
    expect(p2.licenses).toHaveLength(1);
    expect(p1.pages).toBe(2);
    expect(new Set([...p1.licenses, ...p2.licenses].map((l) => l.id)).size).toBe(3);
    expect(LICENSE_LIST_PAGE_SIZE).toBeGreaterThan(0);

    const paid = await sale(db, gw, store, { buyer, tier: 'paid_ad' });
    const later = new Date(Date.now() + 400 * 86_400_000);
    const row = (await listBuyerLicenses(db, buyer.owner.userId, {}, later)).licenses.find((l) => l.id === paid.licenseId);
    expect(row?.status).toBe('expired');
  });
});

describe('invoices and credit notes', () => {
  it('lists invoices for the buyer\'s licenses only, and a credit note once the sale is refunded', async () => {
    const buyer = await readyBuyer(db);
    const s = await sale(db, gw, store, { buyer });
    const stranger = await sale(db, gw, store);
    let rows = await listBuyerBilling(db, buyer.owner.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ licenseId: s.licenseId, creditNote: null });
    expect(rows[0]!.invoice.totalPaise).toBe(rows[0]!.invoice.taxablePaise + rows[0]!.invoice.cgstPaise + rows[0]!.invoice.sgstPaise + rows[0]!.invoice.igstPaise);
    expect(rows.map((r) => r.licenseId)).not.toContain(stranger.licenseId);

    const r = await requestRefund(db, await adminCtx(db, ['finance']), s.orderId, { reason: 'claim_not_released' });
    if (!r.ok) throw new Error(r.reason);
    await executeRefund(db, r.refundId, { gateway: gw, store });
    rows = await listBuyerBilling(db, buyer.owner.userId);
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, s.orderId));
    const [note] = await db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv!.id));
    expect(rows[0]!.creditNote).toMatchObject({ number: note!.number, totalPaise: inv!.totalPaise, hasPdf: true });

    // the credit note downloads for its own buyer only
    const sign = async (_b: string, key: string) => `https://signed.test/${key}`;
    const actor = { userId: buyer.owner.userId, orgId: buyer.orgId };
    expect(await buyerDocumentUrl(db, actor, s.licenseId!, 'credit-note', sign as never)).toBe(`https://signed.test/${note!.pdfKey}`);
    const other = await readyBuyer(db);
    expect(await buyerDocumentUrl(db, { userId: other.owner.userId, orgId: other.orgId }, s.licenseId!, 'credit-note', sign as never)).toBeNull();
    // a license with no credit note has none to download
    const s2 = await sale(db, gw, store, { buyer });
    expect(await buyerDocumentUrl(db, actor, s2.licenseId!, 'credit-note', sign as never)).toBeNull();
  });
});

describe('verify-page name opt-in (PLAN §7)', () => {
  const orgOf = async (userId: string) => (await listBuyerOrgs(db, userId))[0]!;

  it('masks an individual\'s name until they opt in, and takes it back', async () => {
    const b = await readyBuyer(db, 'individual');
    const s = await sale(db, gw, store, { buyer: b });
    const pid = await publicIdOf(s.licenseId!);
    const name = (await db.select({ n: licenses.licenseeName }).from(licenses).where(eq(licenses.id, s.licenseId!)))[0]!.n;
    expect((await getVerifyView(db, pid))!.licensee).not.toBe(name);
    expect(await setVerifyFullName(db, { userId: b.owner.userId, orgId: b.orgId }, true)).toBe('ok');
    expect((await getVerifyView(db, pid))!.licensee).toBe(name);
    expect((await orgOf(b.owner.userId)).verifyFullName).toBe(true);
    expect(await setVerifyFullName(db, { userId: b.owner.userId, orgId: b.orgId }, false)).toBe('ok');
    expect((await getVerifyView(db, pid))!.licensee).not.toBe(name);
  });

  it('is owner-only, member-only, and meaningless for businesses', async () => {
    const b = await readyBuyer(db, 'individual');
    const member = await makeUser(db);
    await db.insert(memberships).values({ userId: member.userId, orgId: b.orgId, role: 'member' });
    await expect(setVerifyFullName(db, { userId: member.userId, orgId: b.orgId }, true)).rejects.toBeInstanceOf(OrgAccessError);
    const stranger = await makeUser(db);
    await expect(setVerifyFullName(db, { userId: stranger.userId, orgId: b.orgId }, true)).rejects.toBeInstanceOf(OrgAccessError);
    expect((await orgOf(b.owner.userId)).verifyFullName).toBe(false);
    const biz = await readyBuyer(db, 'business');
    expect(await setVerifyFullName(db, { userId: biz.owner.userId, orgId: biz.orgId }, true)).toBe('not_individual');
  });
});
