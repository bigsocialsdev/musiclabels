import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { certificates } from '@/db/schema';
import { addChannelWithClearance, replaceChannelWithClearance } from '@/lib/clearance/server';
import { getLicenseForBuyer } from '@/lib/licensing/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { sale, setupCommerce } from '@/tests/commerce';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { buyerDocumentUrl, refreshStaleCertificates } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const pause = () => new Promise((r) => setTimeout(r, 25)); // generated_at and added_at come from the database clock
const revisions = async (licenseId: string) => (await db.select({ n: count() }).from(certificates).where(eq(certificates.licenseId, licenseId)))[0]!.n;

describe('certificate revisions after channel changes (PLAN §5.3)', () => {
  it('issues one new revision per change, keeps the old ones, and is idempotent', async () => {
    const s = await sale(db, gw, store);
    const actor = { userId: s.buyer.owner.userId, orgId: s.buyer.orgId };
    const licenseId = s.licenseId!;
    expect(await revisions(licenseId)).toBe(1);
    expect(await refreshStaleCertificates(db, store, { licenseId })).toBe(0); // nothing changed yet

    await pause();
    const platform = (await getLicenseForBuyer(db, actor, licenseId))!.caps.allowedPlatforms.find((p) => p !== 'youtube')!;
    const added = await addChannelWithClearance(db, actor, licenseId, { platform, handleOrUrl: '@brand' });
    if (!added.ok) throw new Error(added.issues.join());
    expect(await refreshStaleCertificates(db, store, { licenseId })).toBe(1);
    expect(await revisions(licenseId)).toBe(2);
    expect(await refreshStaleCertificates(db, store, { licenseId })).toBe(0);

    await pause();
    const replaced = await replaceChannelWithClearance(db, actor, licenseId, added.value.channelId, { platform, handleOrUrl: '@brand.official' });
    if (!replaced.ok) throw new Error(replaced.issues.join());
    expect(await refreshStaleCertificates(db, store)).toBeGreaterThanOrEqual(1); // the sweep finds it without a license id
    expect(await revisions(licenseId)).toBe(3);

    const url = await buyerDocumentUrl(db, actor, licenseId, 'certificate', async (_b, _k, _s, name) => `https://signed.test/${name}`);
    expect(url).toMatch(/-r3\.pdf$/); // the buyer downloads the newest revision
  });
});
