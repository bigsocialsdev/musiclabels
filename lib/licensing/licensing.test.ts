import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, licensedChannels, licenseEvents, licenses, sellerProfiles, tracks } from '@/db/schema';
import { PRICE_LEVELS } from '@/lib/catalog';
import type { AdminPermission } from '@/lib/identity';
import { publishLegalDocument } from '@/lib/legal/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { uuidv7 } from '@/lib/platform/ids';
import { activatePriceBook, createPriceBook } from '@/lib/pricing/server';
import { makeBuyer, makeSellableTrack, makeUser } from '@/tests/factories';
import {
  TIERS,
  addChannel,
  addVideoUrl,
  adminRevokeLicense,
  applyLicenseTransition,
  expireLicenses,
  getLicenseByPublicId,
  issueLicense,
  publishTermsVersion,
  quoteLicense,
  registerVideo,
  replaceChannel,
  revokeLicense,
  type ChannelInput,
  type TermsInput,
  type Tier,
} from './server';

afterAll(closeDb);
const db = getDb();

const adminCtx = async (permissions: AdminPermission[]) => ({ userId: (await makeUser(db, { admin: permissions, aal: 'aal2' })).userId, permissions });
const dbMessage = async (q: ReturnType<typeof sql>) => {
  const err = await db.execute(q).then(() => null, (e: Error) => e);
  return ((err?.cause as Error | undefined) ?? err)?.message;
};

const TERMS: Record<Tier, Omit<TermsInput, 'licenseTextDocumentId'>> = {
  creator: { tier: 'creator', termKind: 'perpetual', termMonths: null, videoCap: 1, maxChannels: 3, allowedPlatforms: ['youtube', 'instagram', 'facebook'], organicOnly: true },
  brand_organic: { tier: 'brand_organic', termKind: 'perpetual', termMonths: null, videoCap: 3, maxChannels: 3, allowedPlatforms: ['youtube', 'instagram', 'facebook'], organicOnly: true },
  paid_ad: { tier: 'paid_ad', termKind: 'fixed_months', termMonths: 12, videoCap: null, maxChannels: 3, allowedPlatforms: ['youtube', 'instagram', 'facebook'], organicOnly: false },
};

async function publishTerms(tier: Tier, overrides: Partial<TermsInput> = {}) {
  const sa = await adminCtx(['superadmin']);
  const text = await publishLegalDocument(db, sa, { kind: `license_${tier}`, bodyMarkdown: `${tier} license text ${uuidv7()}` });
  return publishTermsVersion(db, sa, { ...TERMS[tier], licenseTextDocumentId: text.id, ...overrides });
}

beforeAll(async () => {
  for (const tier of TIERS) await publishTerms(tier);
  const a = await adminCtx(['verification']);
  const book = await createPriceBook(
    db,
    a,
    PRICE_LEVELS.flatMap((priceLevel, i) => TIERS.map((tier, j) => ({ priceLevel, tier, amountPaise: 49_900 + i * 50_000 + j * 10_000 }))),
  );
  await activatePriceBook(db, a, book.id);
});

async function issue(tier: Tier, opts: { startsAt?: Date; channels?: ChannelInput[]; orderId?: string } = {}) {
  const track = await makeSellableTrack(db);
  const buyer = await makeBuyer(db);
  const q = await quoteLicense(db, track.trackId, tier);
  if (!q.ok) throw new Error(q.issues.join());
  const input = {
    orderId: opts.orderId ?? uuidv7(),
    trackId: track.trackId,
    trackVersionId: q.value.trackVersionId,
    trackTitle: q.value.trackTitle,
    primaryArtist: q.value.primaryArtist,
    tier,
    termsVersionId: q.value.termsVersionId,
    licenseeName: 'Buyer Media LLP',
    purchaserOrgId: buyer.orgId,
    editsAllowed: q.value.editsAllowed,
    startsAt: opts.startsAt ?? new Date(),
    invoiceNumber: 'MRM/26-27/000001',
    channels: opts.channels ?? [{ platform: 'youtube' as const, handleOrUrl: '@BuyerChannel' }],
  };
  const r = await issueLicense(db, input);
  return { ...r, input, quote: q.value, track, buyer, actor: { userId: buyer.owner.userId, orgId: buyer.orgId } };
}

describe('availability and quote (PLAN 6.1)', () => {
  it('quotes a sellable track from the active price book and the current terms', async () => {
    const track = await makeSellableTrack(db);
    const q = await quoteLicense(db, track.trackId, 'brand_organic');
    expect(q).toMatchObject({ ok: true, value: { trackVersionId: track.trackVersionId, priceLevel: 'L2', amountPaise: 49_900 + 50_000 + 10_000 } });
  });

  it('lists every reason a tier is not sellable', async () => {
    const draft = await makeSellableTrack(db, { status: 'draft', clearanceClass: 'C', paidAds: false, priceLevel: null });
    expect(await quoteLicense(db, draft.trackId, 'paid_ad')).toEqual({
      ok: false,
      issues: ['track_not_published', 'clearance_class_not_sellable', 'tier_not_offered', 'no_price'],
    });
    const organicOff = await makeSellableTrack(db, { organicSocial: false });
    expect(await quoteLicense(db, organicOff.trackId, 'creator')).toEqual({ ok: false, issues: ['tier_not_offered'] });
    expect((await quoteLicense(db, organicOff.trackId, 'paid_ad')).ok).toBe(true);

    const suspendedSeller = await makeSellableTrack(db);
    await db.update(sellerProfiles).set({ status: 'suspended' }).where(eq(sellerProfiles.orgId, suspendedSeller.sellerOrgId));
    expect(await quoteLicense(db, suspendedSeller.trackId, 'creator')).toEqual({ ok: false, issues: ['seller_not_active'] });
    expect(await quoteLicense(db, uuidv7(), 'creator')).toEqual({ ok: false, issues: ['track_not_found'] });
  });

  it('terms must point at that tier license text', async () => {
    const sa = await adminCtx(['superadmin']);
    const wrong = await publishLegalDocument(db, sa, { kind: 'license_creator', bodyMarkdown: `x ${uuidv7()}` });
    await expect(publishTermsVersion(db, sa, { ...TERMS.paid_ad, licenseTextDocumentId: wrong.id })).rejects.toThrow(/license_paid_ad/);
    await expect(publishTermsVersion(db, await adminCtx(['verification']), { ...TERMS.creator, licenseTextDocumentId: wrong.id })).rejects.toThrow(/superadmin/);
  });

  it('terms keep the locked term kind per tier (PLAN 6.1)', async () => {
    await expect(publishTerms('paid_ad', { termKind: 'perpetual', termMonths: null })).rejects.toThrow(/fixed-term/);
    await expect(publishTerms('creator', { termKind: 'fixed_months', termMonths: 12 })).rejects.toThrow(/perpetual/);
  });
});

describe('issuance', () => {
  it('stores the record hash once, resolves by public id and verifies intact', async () => {
    const { license, created, input } = await issue('creator');
    expect(created).toBe(true);
    expect(license.recordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(license).toMatchObject({ status: 'active', endsAt: null, territory: 'worldwide', hashSchema: 'mrm-license-v1', licenseeName: input.licenseeName });

    const resolved = await getLicenseByPublicId(db, license.publicId.toLowerCase().replace(/-/g, ' '));
    expect(resolved).toMatchObject({ id: license.id, effectiveStatus: 'active', recordIntact: true });
    expect(await getLicenseByPublicId(db, 'LIC-00000-00000-00000-00000-000000')).toBeNull();

    const events = await db.select().from(licenseEvents).where(eq(licenseEvents.licenseId, license.id));
    expect(events).toMatchObject([{ fromStatus: 'none', toStatus: 'active', event: 'issue' }]);
  });

  it('is idempotent on order_id, sequentially and under concurrency', async () => {
    const first = await issue('creator');
    const again = await issueLicense(db, first.input);
    expect(again).toMatchObject({ created: false, license: { id: first.license.id, recordHash: first.license.recordHash } });

    const orderId = uuidv7();
    const base = { ...first.input, orderId };
    const results = await Promise.all(Array.from({ length: 6 }, () => issueLicense(db, base)));
    expect(new Set(results.map((r) => r.license.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const [only] = await db.select({ id: licenses.id }).from(licenses).where(eq(licenses.orderId, orderId));
    const channels = await db.select().from(licensedChannels).where(eq(licensedChannels.licenseId, only!.id));
    expect(channels).toHaveLength(1);
  });

  it('paid ad gets a 12-month term; perpetual tiers none', async () => {
    const { license } = await issue('paid_ad', { startsAt: new Date('2026-11-12T10:30:00.000Z') });
    expect(license.endsAt!.toISOString()).toBe('2027-11-12T10:30:00.000Z');
  });

  it('refuses snapshots fulfilment should never produce', async () => {
    const ok = await issue('creator');
    const bad = (patch: object) => issueLicense(db, { ...ok.input, orderId: uuidv7(), ...patch });
    await expect(bad({ tier: 'paid_ad' })).rejects.toThrow(/terms version/);
    await expect(
      bad({ channels: ['a', 'b', 'c', 'd'].map((h) => ({ platform: 'youtube', handleOrUrl: h })) }),
    ).rejects.toThrow(/at most 3/);
    await expect(bad({ channels: [{ platform: 'youtube', handleOrUrl: 'X' }, { platform: 'youtube', handleOrUrl: 'x' }] })).rejects.toThrow(/duplicate/);
    await expect(bad({ trackVersionId: (await makeSellableTrack(db)).trackVersionId })).rejects.toThrow(/ready version/);
    await expect(bad({ channels: [] })).rejects.toThrow();
    await expect(bad({ invoiceNumber: 'X'.repeat(17) })).rejects.toThrow();
  });

  it('takes track title and artist from the snapshot, not the live track', async () => {
    const track = await makeSellableTrack(db);
    const buyer = await makeBuyer(db);
    const q = await quoteLicense(db, track.trackId, 'creator');
    if (!q.ok) throw new Error(q.issues.join());
    await db.update(tracks).set({ title: 'Renamed After Order', primaryArtist: 'Someone Else' }).where(eq(tracks.id, track.trackId));
    const { license } = await issueLicense(db, {
      orderId: uuidv7(),
      ...q.value,
      licenseeName: 'Buyer Media LLP',
      purchaserOrgId: buyer.orgId,
      startsAt: new Date(),
      invoiceNumber: 'MRM/26-27/000002',
      channels: [{ platform: 'youtube', handleOrUrl: '@snap' }],
    });
    expect(license).toMatchObject({ trackTitle: 'Test Track', primaryArtist: 'Artist' });
    expect((await getLicenseByPublicId(db, license.publicId))!.recordIntact).toBe(true);
  });

  it('a named client is the licensee (PLAN 6.3)', async () => {
    const ok = await issue('creator');
    const as = (patch: object) => issueLicense(db, { ...ok.input, orderId: uuidv7(), ...patch });
    await expect(as({ clientName: 'Client Co', licenseeName: 'Agency Ltd' })).rejects.toThrow(/clientName/);
    const { license } = await as({ clientName: 'Client Co', licenseeName: 'Client Co' });
    expect(license).toMatchObject({ clientName: 'Client Co', licenseeName: 'Client Co' });
  });

  it('hashed columns are immutable, licenses are never deleted, and tampering is detected', async () => {
    const { license } = await issue('creator');
    expect(await dbMessage(sql`UPDATE licenses SET licensee_name = 'Mallory' WHERE id = ${license.id}`)).toMatch(/only status fields/);
    expect(await dbMessage(sql`UPDATE licenses SET record_hash = repeat('0', 64) WHERE id = ${license.id}`)).toMatch(/only status fields/);
    expect(await dbMessage(sql`DELETE FROM licenses WHERE id = ${license.id}`)).toMatch(/not allowed/);
    expect(await dbMessage(sql`DELETE FROM licensed_channels WHERE license_id = ${license.id}`)).toMatch(/not allowed/);
    expect(await dbMessage(sql`UPDATE licenses SET revoked_reason = 'fraud' WHERE id = ${license.id}`)).toMatch(/revoke transition|licenses_revoked_check/);

    // Bypass the trigger inside a rolled-back transaction to prove the verify path notices a changed row.
    let tampered: Awaited<ReturnType<typeof getLicenseByPublicId>> = null;
    await db
      .transaction(async (tx) => {
        await tx.execute(sql`ALTER TABLE licenses DISABLE TRIGGER licenses_guard_update`);
        await tx.execute(sql`UPDATE licenses SET licensee_name = 'Mallory' WHERE id = ${license.id}`);
        tampered = await getLicenseByPublicId(tx, license.publicId);
        tx.rollback();
      })
      .catch(() => {});
    expect(tampered).toMatchObject({ licenseeName: 'Mallory', recordIntact: false });
    expect((await getLicenseByPublicId(db, license.publicId))!.recordIntact).toBe(true);
  });
});

describe('terms pinning', () => {
  it('a license keeps the terms version it was sold under after a new version publishes', async () => {
    const before = await issue('creator');
    expect(before.quote.termsVersionId).toBe(before.license.termsVersionId);

    const v2 = await publishTerms('creator', { videoCap: 2 });
    const after = await issue('creator');
    expect(after.license.termsVersionId).toBe(v2.id);
    expect(before.license.termsVersionId).not.toBe(v2.id);

    // Old license: still capped at 1 video by its pinned v1 terms.
    expect((await registerVideo(db, before.actor, before.license.id, { label: 'A', urls: ['https://youtu.be/a1'] })).ok).toBe(true);
    expect(await registerVideo(db, before.actor, before.license.id, { label: 'B', urls: ['https://youtu.be/b1'] })).toEqual({ ok: false, issues: ['video_cap_reached'] });
    // New license: v2 allows 2.
    expect((await registerVideo(db, after.actor, after.license.id, { label: 'A', urls: ['https://youtu.be/a2'] })).ok).toBe(true);
    expect((await registerVideo(db, after.actor, after.license.id, { label: 'B', urls: ['https://youtu.be/b2'] })).ok).toBe(true);

    expect(await dbMessage(sql`UPDATE license_terms_versions SET video_cap = 9 WHERE id = ${v2.id}`)).toMatch(/append-only/);
    await publishTerms('creator'); // restore the default cap for later tests
  });
});

describe('caps (PLAN 5.3)', () => {
  it('channels: up to max_channels, allowed platforms only, no duplicates; other orgs see not_found', async () => {
    const { license, actor } = await issue('creator');
    expect((await addChannel(db, actor, license.id, { platform: 'instagram', handleOrUrl: '@brand' })).ok).toBe(true);
    expect(await addChannel(db, actor, license.id, { platform: 'youtube', handleOrUrl: '@buyerchannel' })).toEqual({ ok: false, issues: ['duplicate_channel'] });
    expect((await addChannel(db, actor, license.id, { platform: 'facebook', handleOrUrl: 'fb.com/brand' })).ok).toBe(true);
    expect(await addChannel(db, actor, license.id, { platform: 'youtube', handleOrUrl: '@fourth' })).toEqual({ ok: false, issues: ['channel_cap_reached'] });

    const stranger = await makeBuyer(db);
    expect(await addChannel(db, { userId: stranger.owner.userId, orgId: stranger.orgId }, license.id, { platform: 'youtube', handleOrUrl: '@x' })).toEqual({
      ok: false,
      issues: ['not_found'],
    });
    // Claiming the right org without being a member of it does not help.
    expect(await addChannel(db, { userId: stranger.owner.userId, orgId: actor.orgId }, license.id, { platform: 'youtube', handleOrUrl: '@x' })).toEqual({
      ok: false,
      issues: ['not_found'],
    });
  });

  it('channels: concurrent adds never exceed the cap', async () => {
    const { license, actor } = await issue('brand_organic');
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => addChannel(db, actor, license.id, { platform: 'instagram', handleOrUrl: `@c${i}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const active = await db
      .select()
      .from(licensedChannels)
      .where(and(eq(licensedChannels.licenseId, license.id), sql`removed_at is null`));
    expect(active).toHaveLength(3);
  });

  it('channel corrections: at most 2, and only before any video is registered', async () => {
    const { license, actor } = await issue('brand_organic');
    const [ch] = await db.select().from(licensedChannels).where(eq(licensedChannels.licenseId, license.id));
    const r1 = await replaceChannel(db, actor, license.id, ch!.id, { platform: 'youtube', handleOrUrl: '@fixed1' });
    expect(r1.ok).toBe(true);
    const r2 = await replaceChannel(db, actor, license.id, r1.ok ? r1.value.channelId : '', { platform: 'youtube', handleOrUrl: '@fixed2' });
    expect(r2.ok).toBe(true);
    const id2 = r2.ok ? r2.value.channelId : '';
    expect(await replaceChannel(db, actor, license.id, id2, { platform: 'youtube', handleOrUrl: '@fixed3' })).toEqual({ ok: false, issues: ['correction_limit_reached'] });

    const other = await issue('brand_organic');
    const [och] = await db.select().from(licensedChannels).where(eq(licensedChannels.licenseId, other.license.id));
    await registerVideo(db, other.actor, other.license.id, { label: 'Launch', urls: ['https://youtu.be/launch'] });
    expect(await replaceChannel(db, other.actor, other.license.id, och!.id, { platform: 'youtube', handleOrUrl: '@new' })).toEqual({
      ok: false,
      issues: ['videos_registered'],
    });
  });

  it('videos: brand organic capped at 3 even under concurrency; cross-posts do not count', async () => {
    const { license, actor } = await issue('brand_organic');
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((i) => registerVideo(db, actor, license.id, { label: `Creative ${i}`, urls: [`https://youtu.be/v${i}`] })),
    );
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(3);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.issues[0] === 'video_cap_reached')).toBe(true);

    const videoId = ok[0]!.ok ? ok[0]!.value.videoId : '';
    expect(await addVideoUrl(db, actor, license.id, videoId, 'https://www.instagram.com/reel/abc')).toEqual({ ok: true, value: undefined });
    expect(await addVideoUrl(db, actor, license.id, videoId, 'https://www.instagram.com/reel/abc')).toEqual({ ok: true, value: undefined });
    await expect(addVideoUrl(db, actor, license.id, videoId, 'javascript:alert(1)')).rejects.toThrow();
    await expect(registerVideo(db, actor, license.id, { label: 'x', urls: ['http://youtu.be/plain'] })).rejects.toThrow();
  });

  it('videos: paid ad has no creative cap', async () => {
    const { license, actor } = await issue('paid_ad');
    for (let i = 0; i < 6; i++) {
      expect((await registerVideo(db, actor, license.id, { label: `Ad ${i}`, urls: [`https://youtu.be/ad${i}`] })).ok).toBe(true);
    }
  });
});

describe('expiry', () => {
  it('an expired paid-ad license resolves as expired before and after the sweep', async () => {
    const started = new Date(Date.now() - 400 * 86_400_000);
    const { license, actor } = await issue('paid_ad', { startsAt: started });
    const perpetual = await issue('creator', { startsAt: started });

    const before = await getLicenseByPublicId(db, license.publicId);
    expect(before).toMatchObject({ status: 'active', effectiveStatus: 'expired', recordIntact: true });
    expect(await registerVideo(db, actor, license.id, { label: 'late', urls: ['https://youtu.be/late'] })).toEqual({ ok: false, issues: ['license_not_active'] });

    expect(await expireLicenses(db)).toBeGreaterThanOrEqual(1);
    expect(await getLicenseByPublicId(db, license.publicId)).toMatchObject({ status: 'expired', effectiveStatus: 'expired', recordIntact: true });
    expect(await getLicenseByPublicId(db, perpetual.license.publicId)).toMatchObject({ status: 'active', effectiveStatus: 'active' });

    const events = await db.select().from(licenseEvents).where(and(eq(licenseEvents.licenseId, license.id), eq(licenseEvents.event, 'expire')));
    expect(events).toMatchObject([{ fromStatus: 'active', toStatus: 'expired', actorUserId: null }]);
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, license.id), eq(auditLog.action, 'license.expire')));
    expect(audits).toMatchObject([{ actorUserId: null }]);

    // Re-running the sweep is a no-op for it.
    await expireLicenses(db);
    expect(await db.select().from(licenseEvents).where(and(eq(licenseEvents.licenseId, license.id), eq(licenseEvents.event, 'expire')))).toHaveLength(1);
  });

  it('cannot expire a perpetual or unexpired license, nor revive an expired one', async () => {
    const perpetual = await issue('creator');
    expect(await applyLicenseTransition(db, perpetual.license.id, 'expire', { actorUserId: null })).toEqual({ ok: false, reason: 'not_due', status: 'active' });
    const current = await issue('paid_ad');
    expect(await applyLicenseTransition(db, current.license.id, 'expire', { actorUserId: null })).toEqual({ ok: false, reason: 'not_due', status: 'active' });
    // The DB enforces the same rule against stray writes.
    expect(await dbMessage(sql`UPDATE licenses SET status = 'expired' WHERE id = ${perpetual.license.id}`)).toMatch(/past ends_at/);
    expect(await dbMessage(sql`UPDATE licenses SET status = 'expired' WHERE id = ${current.license.id}`)).toMatch(/past ends_at/);

    const lapsed = await issue('paid_ad', { startsAt: new Date(Date.now() - 400 * 86_400_000) });
    expect((await applyLicenseTransition(db, lapsed.license.id, 'expire', { actorUserId: null })).ok).toBe(true);
    expect(await dbMessage(sql`UPDATE licenses SET status = 'active' WHERE id = ${lapsed.license.id}`)).toMatch(/expired -> active/);
  });
});

describe('revocation', () => {
  it('admin revocation needs the disputes permission and writes event + audit', async () => {
    const { license } = await issue('creator');
    await expect(adminRevokeLicense(db, await adminCtx(['finance']), license.id, { reason: 'fraud', note: 'stolen card' })).rejects.toThrow(/disputes/);
    const admin = await adminCtx(['disputes']);
    expect(await adminRevokeLicense(db, admin, license.id, { reason: 'fraud', note: 'stolen card' })).toEqual({ ok: true, from: 'active', to: 'revoked' });

    const resolved = await getLicenseByPublicId(db, license.publicId);
    expect(resolved).toMatchObject({ status: 'revoked', effectiveStatus: 'revoked', revokedReason: 'fraud', recordIntact: true });
    expect(resolved!.revokedAt).toBeInstanceOf(Date);
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.entityId, license.id), eq(auditLog.action, 'license.revoke')));
    expect(audits).toMatchObject([{ actorUserId: admin.userId, after: { status: 'revoked', revokedReason: 'fraud', note: 'stolen card' } }]);

    expect(await revokeLicense(db, license.id, { reason: 'refund' })).toEqual({ ok: false, reason: 'invalid', status: 'revoked' });
    expect(await dbMessage(sql`UPDATE licenses SET status = 'active', revoked_reason = null, revoked_at = null WHERE id = ${license.id}`)).toMatch(
      /revoked -> active/,
    );
  });

  it('concurrent revocations: exactly one wins', async () => {
    const { license } = await issue('paid_ad');
    const results = await Promise.all([
      revokeLicense(db, license.id, { reason: 'refund' }),
      revokeLicense(db, license.id, { reason: 'chargeback_lost' }),
      revokeLicense(db, license.id, { reason: 'refund' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && ['conflict', 'invalid'].includes(r.reason))).toBe(true);
    const events = await db.select().from(licenseEvents).where(and(eq(licenseEvents.licenseId, license.id), eq(licenseEvents.event, 'revoke')));
    expect(events).toHaveLength(1);
  });
});
