import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { genres, rightsDocuments, trackVersions, tracks } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { makeSeller, makeTrack, makeUser } from '@/tests/factories';
import { applyTransition, CatalogError, getOwnTrack, listOwnTracks, listTaxonomy, rejectTrack, saveRightsDeclaration, type SellerActor } from './server';

afterAll(closeDb);
const db = getDb();

const actorOf = (s: { owner: { userId: string }; orgId: string }): SellerActor => ({ userId: s.owner.userId, orgId: s.orgId });
const err = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

describe('what a seller can read', () => {
  it('lists and opens only the own org’s tracks; another org’s track looks missing', async () => {
    const mine = await makeSeller(db);
    const theirs = await makeSeller(db);
    const myTrack = await makeTrack(db, mine.orgId, 'draft');
    const theirTrack = await makeTrack(db, theirs.orgId, 'published');

    const list = await listOwnTracks(db, actorOf(mine));
    expect(list.map((t) => t.id)).toEqual([myTrack]);
    expect(JSON.stringify(list)).not.toContain(theirTrack);

    expect((await getOwnTrack(db, actorOf(mine), myTrack))?.track.id).toBe(myTrack);
    expect(await getOwnTrack(db, actorOf(mine), theirTrack)).toBeNull();
    expect(await getOwnTrack(db, actorOf(theirs), myTrack)).toBeNull();
  });

  it('refuses a user who is not a member of the org they name', async () => {
    const s = await makeSeller(db);
    const stranger = await makeUser(db);
    expect(await err(listOwnTracks(db, { userId: stranger.userId, orgId: s.orgId }))).toBeInstanceOf(CatalogError);
    expect(await err(getOwnTrack(db, { userId: stranger.userId, orgId: s.orgId }, await makeTrack(db, s.orgId)))).toBeInstanceOf(CatalogError);
  });

  it('shows versions, declaration and documents without storage keys', async () => {
    const s = await makeSeller(db);
    const id = await makeTrack(db, s.orgId, 'draft');
    await db.insert(trackVersions).values({ trackId: id, versionNo: 1, masterKey: `${s.orgId}/${id}/secret-master.wav`, ingestStatus: 'failed', ingestError: 'Audio is too short' });
    await db.insert(trackVersions).values({ trackId: id, versionNo: 2, masterKey: `${s.orgId}/${id}/secret-master-2.wav`, ingestStatus: 'ready' });
    await db.insert(rightsDocuments).values({ trackId: id, sellerOrgId: s.orgId, docType: 'self_declaration', declaredMime: 'application/pdf', fileKey: `${s.orgId}/${id}/docs/secret-doc.pdf`, validationStatus: 'rejected', validationError: 'Not a PDF' });
    await saveRightsDeclaration(db, actorOf(s), id, { masterControlled: true, compositionControlled: true, coOwnerConsentWarranted: true, sampleFreeWarranted: true, notACoverWarranted: true });

    const detail = (await getOwnTrack(db, actorOf(s), id))!;
    expect(detail.versions.map((v) => [v.versionNo, v.ingestStatus, v.ingestError])).toEqual([[2, 'ready', null], [1, 'failed', 'Audio is too short']]);
    expect(detail.documents).toMatchObject([{ docType: 'self_declaration', status: 'rejected', error: 'Not a PDF' }]);
    expect(detail.declaration).toMatchObject({ masterControlled: true });
    expect(JSON.stringify(detail)).not.toContain('secret');
    expect(detail.rejection).toBeNull();
  });

  it('a rejected track shows the reviewer’s reason, and the latest one after a second rejection', async () => {
    const s = await makeSeller(db);
    const id = await makeTrack(db, s.orgId, 'in_review');
    const admin = { userId: (await makeUser(db, { admin: ['verification'], aal: 'aal2' })).userId, permissions: ['verification' as const] };
    await rejectTrack(db, admin, { trackId: id, reason: 'The composition credits are missing' });
    expect((await getOwnTrack(db, actorOf(s), id))!.rejection).toEqual({ reason: 'The composition credits are missing' });

    await applyTransition(db, id, 'edit', s.owner.userId);
    expect((await getOwnTrack(db, actorOf(s), id))!.rejection).toBeNull(); // back in draft: nothing to show
    await db.update(tracks).set({ status: 'in_review' }).where(eq(tracks.id, id));
    await rejectTrack(db, admin, { trackId: id, reason: 'The audio still contains a sample' });
    expect((await getOwnTrack(db, actorOf(s), id))!.rejection).toEqual({ reason: 'The audio still contains a sample' });
  });

  it('lists only active genres and moods', async () => {
    const name = `Genre ${Math.random().toString(36).slice(2, 8)}`;
    const [on] = await db.insert(genres).values({ name }).returning({ id: genres.id });
    const [off] = await db.insert(genres).values({ name: `${name} off`, active: false }).returning({ id: genres.id });
    const { genres: g } = await listTaxonomy(db);
    expect(g.map((x) => x.id)).toContain(on!.id);
    expect(g.map((x) => x.id)).not.toContain(off!.id);
  });
});
