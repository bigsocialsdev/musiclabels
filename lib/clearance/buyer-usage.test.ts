import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getLicenseForBuyer, getTermsVersion } from '@/lib/licensing/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { sale, setupCommerce } from '@/tests/commerce';
import { makeUser } from '@/tests/factories';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { getBioChallenge, listBuyerClearance, registerVideoWithClearance, startBioCodeVerification } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

const actorOf = (s: Awaited<ReturnType<typeof sale>>) => ({ userId: s.buyer.owner.userId, orgId: s.buyer.orgId });
const video = (n: number) => ({ label: `Cut ${n}`, urls: [`https://youtu.be/v${n}-${Math.random().toString(36).slice(2, 8)}`] });

describe('what the buyer license page reads', () => {
  it('shows the caps the license pinned, and the cap blocks the next video with its reason', async () => {
    const s = await sale(db, gw, store);
    const actor = actorOf(s);
    const view = (await getLicenseForBuyer(db, actor, s.licenseId!))!;
    const pinned = (await getTermsVersion(db, view.license.termsVersionId))!;
    expect(view.caps).toEqual({ videoCap: pinned.videoCap, maxChannels: pinned.maxChannels, allowedPlatforms: pinned.allowedPlatforms });
    expect(view.caps.videoCap).not.toBeNull(); // creator tier is capped

    for (let i = 0; i < view.caps.videoCap!; i++) expect((await registerVideoWithClearance(db, actor, s.licenseId!, video(i))).ok).toBe(true);
    expect(await registerVideoWithClearance(db, actor, s.licenseId!, video(99))).toEqual({ ok: false, issues: ['video_cap_reached'] });
    expect((await getLicenseForBuyer(db, actor, s.licenseId!))!.videos).toHaveLength(view.caps.videoCap!);
  });

  it('lists the clearance request of a registered video, and only to the buyer org', async () => {
    const s = await sale(db, gw, store, { clearanceClass: 'B' });
    const actor = actorOf(s);
    const reg = await registerVideoWithClearance(db, actor, s.licenseId!, video(1));
    if (!reg.ok) throw new Error(reg.issues.join());
    const rows = await listBuyerClearance(db, actor, s.licenseId!);
    expect(rows.find((r) => r.videoId === reg.value.videoId)).toMatchObject({ status: 'pending' });
    const stranger = await makeUser(db);
    expect(await listBuyerClearance(db, { userId: stranger.userId, orgId: s.buyer.orgId }, s.licenseId!)).toEqual([]);
    expect(await listBuyerClearance(db, { userId: s.buyer.owner.userId, orgId: (await sale(db, gw, store)).buyer.orgId }, s.licenseId!)).toEqual([]);
  });
});

describe('the verify page read', () => {
  it('has no code until the buyer asks for one, then returns the open code; strangers see nothing', async () => {
    const s = await sale(db, gw, store);
    const actor = actorOf(s);
    const channelId = (await getLicenseForBuyer(db, actor, s.licenseId!))!.channels[0]!.id;
    expect(await getBioChallenge(db, actor, channelId)).toMatchObject({ code: null, channel: { id: channelId, licenseId: s.licenseId } });
    const started = await startBioCodeVerification(db, actor, channelId);
    if (!started.ok) throw new Error(started.reason);
    expect((await getBioChallenge(db, actor, channelId))!.code).toBe(started.value.code);
    const stranger = await makeUser(db);
    expect(await getBioChallenge(db, { userId: stranger.userId, orgId: s.buyer.orgId }, channelId)).toBeNull();
  });
});
