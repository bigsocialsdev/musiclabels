import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeUser } from '@/tests/factories';
import { createOrganization, ensureUser, getMembershipRole, requireAal2, requireAdmin, requireVerified } from './server';

afterAll(closeDb);
const db = getDb();

describe('requireVerified', () => {
  it('blocks anonymous and unverified users', async () => {
    expect(requireVerified(null)).toEqual({ ok: false, reason: 'unauthenticated' });
    const unverified = await makeUser(db, { verified: false });
    expect(requireVerified(unverified)).toEqual({ ok: false, reason: 'unverified' });
    expect(requireVerified(await makeUser(db)).ok).toBe(true);
  });
});

describe('requireAdmin', () => {
  it('blocks an admin session at AAL1 until MFA is done', async () => {
    const aal1 = await makeUser(db, { admin: ['finance'], aal: 'aal1' });
    expect(await requireAdmin(aal1, 'finance')).toEqual({ ok: false, reason: 'mfa_required' });
    const r = await requireAdmin({ ...aal1, aal: 'aal2' }, 'finance');
    expect(r).toMatchObject({ ok: true, value: { userId: aal1.userId } });
  });

  it('blocks non-admins and admins without the permission', async () => {
    const plain = await makeUser(db, { aal: 'aal2' });
    expect(await requireAdmin(plain, 'finance')).toEqual({ ok: false, reason: 'forbidden' });
    const clearance = await makeUser(db, { admin: ['clearance'], aal: 'aal2' });
    expect(await requireAdmin(clearance, 'finance')).toEqual({ ok: false, reason: 'forbidden' });
    expect((await requireAdmin(clearance, 'clearance')).ok).toBe(true);
  });

  it('superadmin has every permission', async () => {
    const s = await makeUser(db, { admin: ['superadmin'], aal: 'aal2' });
    for (const p of ['verification', 'clearance', 'disputes', 'finance', 'superadmin'] as const) {
      expect((await requireAdmin(s, p)).ok).toBe(true);
    }
  });

  it('reads the role from the database, not the session', async () => {
    const s = await makeUser(db, { admin: ['finance'], aal: 'aal2' });
    await db.update(users).set({ platformRole: 'none' }).where(eq(users.id, s.userId));
    expect(await requireAdmin(s, 'finance')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('rejects unauthenticated and unverified callers before touching roles', async () => {
    expect(await requireAdmin(null, 'finance')).toEqual({ ok: false, reason: 'unauthenticated' });
    const u = await makeUser(db, { admin: ['finance'], aal: 'aal2', verified: false });
    expect(await requireAdmin(u, 'finance')).toEqual({ ok: false, reason: 'unverified' });
  });
});

describe('requireAal2', () => {
  it('needs a TOTP-backed session', async () => {
    const s = await makeUser(db);
    expect(requireAal2(s)).toEqual({ ok: false, reason: 'mfa_required' });
    expect(requireAal2({ ...s, aal: 'aal2' }).ok).toBe(true);
  });
});

describe('ensureUser', () => {
  it('creates a user once, refreshes contact details, and never grants roles', async () => {
    const fresh = { userId: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.com`, phone: null, verified: true, aal: 'aal1' as const };
    await ensureUser(db, fresh);
    const phone = `+919${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
    await ensureUser(db, { ...fresh, phone });
    const [row] = await db.select().from(users).where(eq(users.id, fresh.userId));
    expect(row).toMatchObject({ phone, platformRole: 'none', adminPermissions: [] });
    expect(row!.verifiedAt).toBeInstanceOf(Date);
  });

  it('does not erase a stored email or phone when a sign-in method lacks it', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const phone = `+919${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
    const base = { userId: crypto.randomUUID(), verified: true, aal: 'aal1' as const };
    await ensureUser(db, { ...base, email, phone });
    await ensureUser(db, { ...base, email: null, phone: null });
    const [row] = await db.select().from(users).where(eq(users.id, base.userId));
    expect(row).toMatchObject({ email, phone });
  });

  it('refuses an unverified session', async () => {
    const s = await makeUser(db, { verified: false });
    await expect(ensureUser(db, s)).rejects.toThrow(/unverified/);
  });
});

describe('organizations', () => {
  it('creates the org with the caller as owner and scopes membership checks', async () => {
    const owner = await makeUser(db);
    const stranger = await makeUser(db);
    const orgId = await createOrganization(db, owner.userId, { kind: 'buyer', legalName: 'Acme Pvt Ltd', displayName: 'Acme' });
    expect(await getMembershipRole(db, owner.userId, orgId)).toBe('owner');
    expect(await getMembershipRole(db, stranger.userId, orgId)).toBeNull();
  });

  it('rolls back the org if the owner membership fails', async () => {
    await expect(
      createOrganization(db, crypto.randomUUID(), { kind: 'seller', legalName: 'X', displayName: 'X' }),
    ).rejects.toThrow();
  });
});
