import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog, licenses, sellerProfiles, tracks } from '@/db/schema';
import { setupCommerce, adminCtx, readyBuyer, sale } from '@/tests/commerce';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { makeBuyer, makeSellableTrack, makeSeller, makeTrack, makeUser } from '@/tests/factories';
import { setTrackAvailability } from '@/lib/catalog/server';
import { getMembershipRole, PermissionError } from '@/lib/identity/server';
import { listBuyerBilling } from '@/lib/invoicing/server';
import { listBuyerLicenses } from '@/lib/licensing/server';
import { createOrder } from '@/lib/orders/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { reinstateOrg, listKycQueue, searchAccounts, suspendOrg, viewOrgSummary } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();
beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const trackStatus = async (id: string) => (await db.select({ s: tracks.status }).from(tracks).where(eq(tracks.id, id)))[0]!.s;
const auditRows = (action: string, entityId: string) => db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.entityId, entityId))).orderBy(desc(auditLog.at));

describe('suspending a seller organisation (S4-M10c)', () => {
  it('locks members out, takes published tracks off sale, leaves sold licenses valid, and reinstating reverses exactly that', async () => {
    const admin = await adminCtx(db, ['superadmin']);
    const s = await sale(db, gw, store); // a published track with a fulfilled license
    const orgId = s.sellerOrgId;
    const published2 = await makeSellableTrack(db, { sellerOrgId: orgId });
    const draft = await makeTrack(db, orgId, 'draft');
    const classC = await makeSellableTrack(db, { sellerOrgId: orgId, clearanceClass: 'C', status: 'suspended' });
    const adminSuspended = await makeSellableTrack(db, { sellerOrgId: orgId });
    expect((await setTrackAvailability(db, admin, { trackId: adminSuspended.trackId, action: 'suspend', reason: 'rights query' })).ok).toBe(true);
    const member = await db.query.memberships.findFirst({ where: (m, { eq: e }) => e(m.orgId, orgId) });
    expect(await getMembershipRole(db, member!.userId, orgId)).toBe('owner');

    const r = await suspendOrg(db, admin, { orgId, reason: 'chargeback ring' }, '10.0.0.1');
    expect(r).toEqual({ ok: true, pausedTracks: 2, sellerSuspended: true }); // the sale's track and published2

    expect(await getMembershipRole(db, member!.userId, orgId)).toBeNull();
    expect((await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, orgId)))[0]!.status).toBe('suspended');
    expect(await trackStatus(s.trackId)).toBe('suspended');
    expect(await trackStatus(published2.trackId)).toBe('suspended');
    expect(await trackStatus(draft)).toBe('draft');
    expect((await db.select({ s: licenses.status }).from(licenses).where(eq(licenses.id, s.licenseId!)))[0]!.s).toBe('active');

    const [audit] = await auditRows('org.suspend', orgId);
    expect(audit).toMatchObject({ actorUserId: admin.userId, ip: '10.0.0.1' });
    expect((audit!.after as { pausedTrackIds: string[] }).pausedTrackIds.sort()).toEqual([s.trackId, published2.trackId].sort());

    expect(await suspendOrg(db, admin, { orgId, reason: 'again' })).toEqual({ ok: false, reason: 'already_suspended' });
    expect(await auditRows('org.suspend', orgId)).toHaveLength(1);

    const back = await reinstateOrg(db, admin, { orgId, reason: 'cleared' });
    expect(back).toEqual({ ok: true, resumedTracks: 2, sellerReinstated: true });
    expect(await getMembershipRole(db, member!.userId, orgId)).toBe('owner');
    expect((await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, orgId)))[0]!.status).toBe('active');
    expect(await trackStatus(s.trackId)).toBe('published');
    expect(await trackStatus(published2.trackId)).toBe('published');
    expect(await trackStatus(adminSuspended.trackId)).toBe('suspended'); // suspended earlier by an admin, for another reason
    expect(await trackStatus(classC.trackId)).toBe('suspended'); // class C is never put back on sale
    expect(await reinstateOrg(db, admin, { orgId, reason: 'again' })).toEqual({ ok: false, reason: 'not_suspended' });
    expect(await auditRows('org.reinstate', orgId)).toHaveLength(1);
  });

  it('suspends a buyer organisation without touching any track', async () => {
    const admin = await adminCtx(db, ['superadmin']);
    const b = await makeBuyer(db);
    expect(await suspendOrg(db, admin, { orgId: b.orgId, reason: 'payment fraud' })).toEqual({ ok: true, pausedTracks: 0, sellerSuspended: false });
    expect(await getMembershipRole(db, b.owner.userId, b.orgId)).toBeNull();
    expect(await reinstateOrg(db, admin, { orgId: b.orgId, reason: 'cleared' })).toEqual({ ok: true, resumedTracks: 0, sellerReinstated: false });
    expect(await getMembershipRole(db, b.owner.userId, b.orgId)).toBe('owner');
  });

  it('closes checkout to a suspended buyer organisation', async () => {
    const admin = await adminCtx(db, ['superadmin']);
    const buyer = await readyBuyer(db);
    const track = await makeSellableTrack(db);
    const order = () => createOrder(db, buyer.session, { trackId: track.trackId, tier: 'creator', channels: [{ platform: 'youtube', handleOrUrl: '@b' }], billingStateCode: '27', idempotencyKey: `k-${Math.random()}` }, gw);
    expect((await order()).ok).toBe(true);
    await suspendOrg(db, admin, { orgId: buyer.orgId, reason: 'payment fraud' });
    expect(await order()).toEqual({ ok: false, issues: ['not_found'] });
    await reinstateOrg(db, admin, { orgId: buyer.orgId, reason: 'cleared' });
    expect((await order()).ok).toBe(true);
  });

  it('hides the licenses and invoices of a suspended organisation from its members', async () => {
    const admin = await adminCtx(db, ['superadmin']);
    const s = await sale(db, gw, store);
    const userId = s.buyer.owner.userId;
    expect((await listBuyerLicenses(db, userId)).total).toBe(1);
    expect(await listBuyerBilling(db, userId)).toHaveLength(1);
    await suspendOrg(db, admin, { orgId: s.buyer.orgId, reason: 'payment fraud' });
    expect((await listBuyerLicenses(db, userId)).total).toBe(0);
    expect(await listBuyerBilling(db, userId)).toHaveLength(0);
    await reinstateOrg(db, admin, { orgId: s.buyer.orgId, reason: 'cleared' });
    expect((await listBuyerLicenses(db, userId)).total).toBe(1);
  });

  it('needs superadmin and a reason, and reports an unknown organisation', async () => {
    const other = await adminCtx(db, ['verification', 'finance']);
    const s = await makeSeller(db);
    await expect(suspendOrg(db, other, { orgId: s.orgId, reason: 'x' })).rejects.toBeInstanceOf(PermissionError);
    await expect(reinstateOrg(db, other, { orgId: s.orgId, reason: 'x' })).rejects.toBeInstanceOf(PermissionError);
    const admin = await adminCtx(db, ['superadmin']);
    await expect(suspendOrg(db, admin, { orgId: s.orgId, reason: '   ' })).rejects.toThrow(/reason/);
    expect(await suspendOrg(db, admin, { orgId: '00000000-0000-7000-8000-000000000001', reason: 'x' })).toEqual({ ok: false, reason: 'not_found' });
    expect((await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, s.orgId)))[0]!.status).toBe('active');
  });
});

describe('read-only org summary', () => {
  it('writes one audit row per view naming the admin, and shows no PAN or bank data', async () => {
    const admin = await adminCtx(db, ['superadmin']);
    const s = await makeSeller(db);
    const view = await viewOrgSummary(db, admin, s.orgId, '10.0.0.2');
    expect(view!.members.map((m) => m.userId)).toEqual([s.owner.userId]);
    expect(view!.seller).toMatchObject({ status: 'active', kycStatus: 'verified', hasPan: false });
    expect(JSON.stringify(view)).not.toMatch(/pan_encrypted|panEncrypted|bank/i);
    await viewOrgSummary(db, admin, s.orgId);
    const rows = await auditRows('org.view_summary', s.orgId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actorUserId === admin.userId)).toBe(true);
  });

  it('returns null and audits nothing for an unknown organisation; refuses non-superadmins', async () => {
    const admin = await adminCtx(db, ['superadmin']);
    const ghost = '00000000-0000-7000-8000-000000000002';
    expect(await viewOrgSummary(db, admin, ghost)).toBeNull();
    expect(await auditRows('org.view_summary', ghost)).toHaveLength(0);
    await expect(viewOrgSummary(db, await adminCtx(db, ['verification']), ghost)).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('search and the KYC queue', () => {
  it('finds a person by email fragment and an org by name, treats % as text, and ignores a one-letter query', async () => {
    const admin = await adminCtx(db, ['superadmin']);
    const u = await makeUser(db);
    const b = await makeBuyer(db, 'Zyxwvut Mediaworks');
    const byName = await searchAccounts(db, admin, 'zyxwvut');
    expect(byName.orgs.map((o) => o.id)).toContain(b.orgId);
    expect((await searchAccounts(db, admin, u.email!.slice(0, 12))).users.map((x) => x.id)).toContain(u.userId);
    expect(await searchAccounts(db, admin, '%%')).toEqual({ users: [], orgs: [] });
    expect(await searchAccounts(db, admin, 'z')).toEqual({ users: [], orgs: [] });
    await expect(searchAccounts(db, await adminCtx(db, ['finance']), 'zyxwvut')).rejects.toBeInstanceOf(PermissionError);
  });

  it('lists sellers by KYC status for verification admins only, never returning the PAN', async () => {
    const verifier = await adminCtx(db, ['verification']);
    const pending = await makeSeller(db, { kyc: 'pending' });
    const done = await makeSeller(db, { kyc: 'verified' });
    const queue = await listKycQueue(db, verifier, 'pending');
    expect(queue.map((r) => r.orgId)).toContain(pending.orgId);
    expect(queue.map((r) => r.orgId)).not.toContain(done.orgId);
    expect(JSON.stringify(queue)).not.toMatch(/panEncrypted/);
    await expect(listKycQueue(db, await adminCtx(db, ['finance']))).rejects.toBeInstanceOf(PermissionError);
  });
});
