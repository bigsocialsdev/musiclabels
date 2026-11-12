import { afterAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { acceptances, auditLog, rightsDocuments, screenings, trackEvents, trackVersions, tracks } from '@/db/schema';
import { closeDb, getDb } from '@/lib/platform/db';
import { runFfmpeg } from '@/lib/platform/ffmpeg';
import { ObjectNotFoundError, type ObjectStore } from '@/lib/platform/storage';
import { publishLegalDocument, getCurrentDocument } from '@/lib/legal/server';
import { recordClaimProbe, type FingerprintScreener } from '@/lib/screening/server';
import { makeSeller, makeTrack, makeUser } from '@/tests/factories';
import {
  approveTrack,
  confirmMasterUpload,
  confirmRightsDocument,
  createTrack,
  delistOwnTrack,
  editTrack,
  processVersion,
  rejectTrack,
  saveRightsDeclaration,
  setTrackAvailability,
  submitTrack,
  sweepCatalog,
  updateTrack,
  type SellerActor,
} from './server';

afterAll(closeDb);
const db = getDb();

const warranties = { masterControlled: true, compositionControlled: true, coOwnerConsentWarranted: true, sampleFreeWarranted: true, notACoverWarranted: true };
const trackInput = { title: 'Monsoon Drive', primaryArtist: 'The Band', language: 'english' as const };

// ---- fakes ----
const files = new Map<string, string>(); // `${bucket}/${key}` -> local file
const store: ObjectStore = {
  async downloadToFile(bucket, key, dest) {
    const src = files.get(`${bucket}/${key}`);
    if (!src) throw new ObjectNotFoundError(bucket, key);
    await copyFile(src, dest);
  },
  async upload(bucket, key, data) {
    files.set(`${bucket}/${key}`, await tmpFile('out', data));
  },
};
const screener = (status: 'clean' | 'match'): FingerprintScreener => ({
  id: 'fake',
  async screen() {
    return status === 'clean'
      ? { status: 'clean', matches: [] }
      : { status: 'match', matches: [{ title: 'Famous', artist: 'Someone', score: 99, source: 'acrcloud' }] };
  },
});

async function tmpFile(name: string, bytes: Buffer | string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mrm-cat-'));
  const f = path.join(dir, name);
  await writeFile(f, bytes);
  return f;
}
let tone = 200 + Math.random() * 3000; // random per run: the test database persists, and an old row with the same audio would flag a duplicate
/** A distinct tone per call, so every upload has its own sha256 (identical audio is flagged as a cross-seller duplicate). */
async function makeAudio() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mrm-cat-audio-'));
  const file = path.join(dir, 'a.wav');
  const r = await runFfmpeg(['-y', '-f', 'lavfi', '-i', `sine=frequency=${(tone += 1.37).toFixed(3)}:duration=16`, '-ar', '44100', '-ac', '2', file]);
  expect(r.code).toBe(0);
  return file;
}

const superadmin = () => makeUser(db, { admin: ['superadmin'], aal: 'aal2' });
const adminCtx = (s: { userId: string }, permissions: ('verification' | 'finance' | 'superadmin')[] = ['verification']) => ({ userId: s.userId, permissions });

async function acceptAgreement(kind: 'seller_agreement' | 'release_commitment', orgId: string, userId: string) {
  const sa = await superadmin();
  const doc = (await getCurrentDocument(db, kind)) ?? (await publishLegalDocument(db, { userId: sa.userId, permissions: ['superadmin'] }, { kind, bodyMarkdown: `${kind} text` }));
  await db.insert(acceptances).values({ userId, orgId, legalDocumentId: doc.id }).onConflictDoNothing();
}

/** A seller with an agreement, a draft track with declaration, one valid document and an ingested version. */
async function readyDraft(opts: { kyc?: 'pending' | 'verified' | 'rejected' } = {}) {
  const { owner, orgId } = await makeSeller(db, { kyc: opts.kyc });
  const actor: SellerActor = { userId: owner.userId, orgId };
  await acceptAgreement('seller_agreement', orgId, owner.userId);
  const trackId = await createTrack(db, actor, trackInput);
  await saveRightsDeclaration(db, actor, trackId, warranties);
  const [doc] = await db
    .insert(rightsDocuments)
    .values({ trackId, sellerOrgId: orgId, docType: 'self_declaration', declaredMime: 'application/pdf', fileKey: `${orgId}/${trackId}/d.pdf`, validationStatus: 'valid' })
    .returning({ id: rightsDocuments.id });
  const versionId = crypto.randomUUID();
  await confirmMasterUpload(db, actor, trackId, versionId, 'wav');
  files.set(`masters/${orgId}/${trackId}/${versionId}.wav`, await makeAudio());
  return { actor, orgId, trackId, versionId, docId: doc!.id, owner };
}

/** Takes a draft all the way to `in_review` through the real pipeline. */
async function inReview(status: 'clean' | 'match' = 'clean') {
  const d = await readyDraft();
  await processVersion(d.versionId, { store, screener: screener(status) });
  const sub = await submitTrack(db, d.actor, d.trackId);
  expect(sub.ok).toBe(true);
  await processVersion(d.versionId, { store, screener: screener(status) });
  expect((await trackRow(d.trackId)).status).toBe('in_review');
  return d;
}
const trackRow = async (id: string) => (await db.select().from(tracks).where(eq(tracks.id, id)))[0]!;

describe('seller side', () => {
  it('creates and edits drafts only for the caller’s own org', async () => {
    const a = await makeSeller(db);
    const b = await makeSeller(db);
    const actorA: SellerActor = { userId: a.owner.userId, orgId: a.orgId };
    const trackId = await createTrack(db, actorA, trackInput);
    await updateTrack(db, actorA, trackId, { ...trackInput, title: 'Renamed' });
    expect((await trackRow(trackId)).title).toBe('Renamed');

    // another org's member, and a member naming someone else's org, are both refused
    await expect(updateTrack(db, { userId: b.owner.userId, orgId: b.orgId }, trackId, trackInput)).rejects.toThrow(/Track not found/);
    await expect(updateTrack(db, { userId: b.owner.userId, orgId: a.orgId }, trackId, trackInput)).rejects.toThrow(/Not a member/);
    await expect(createTrack(db, { userId: b.owner.userId, orgId: a.orgId }, trackInput)).rejects.toThrow(/Not a member/);
  });

  it('numbers versions per track and confirming twice is a no-op', async () => {
    const { owner, orgId } = await makeSeller(db);
    const actor: SellerActor = { userId: owner.userId, orgId };
    const trackId = await createTrack(db, actor, trackInput);
    const v1 = crypto.randomUUID();
    const v2 = crypto.randomUUID();
    await confirmMasterUpload(db, actor, trackId, v1, 'wav');
    await confirmMasterUpload(db, actor, trackId, v1, 'wav');
    await confirmMasterUpload(db, actor, trackId, v2, 'mp3');
    const rows = await db.select().from(trackVersions).where(eq(trackVersions.trackId, trackId)).orderBy(trackVersions.versionNo);
    expect(rows.map((r) => [r.id, r.versionNo])).toEqual([[v1, 1], [v2, 2]]);
    await expect(confirmMasterUpload(db, actor, trackId, crypto.randomUUID(), 'exe')).rejects.toThrow(/WAV or MP3/);
    // a version id that belongs to another track cannot be claimed (or re-processed) through this one
    const otherTrack = await createTrack(db, actor, trackInput);
    await expect(confirmMasterUpload(db, actor, otherTrack, v1, 'wav')).rejects.toThrow(/Invalid upload/);
  });

  it('F9: a renamed executable posing as PDF is rejected; a real PDF is accepted', async () => {
    const { owner, orgId } = await makeSeller(db);
    const actor: SellerActor = { userId: owner.userId, orgId };
    const trackId = await createTrack(db, actor, trackInput);
    const add = async (fileKey: string) =>
      (
        await db
          .insert(rightsDocuments)
          .values({ trackId, sellerOrgId: orgId, docType: 'other', declaredMime: 'application/pdf', fileKey })
          .returning({ id: rightsDocuments.id })
      )[0]!.id;

    const exe = await add(`${orgId}/${trackId}/docs/evil.pdf`);
    files.set(`documents/${orgId}/${trackId}/docs/evil.pdf`, await tmpFile('evil.pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)])));
    expect(await confirmRightsDocument(db, actor, exe, store)).toMatchObject({ status: 'rejected' });

    const good = await add(`${orgId}/${trackId}/docs/ok.pdf`);
    files.set(`documents/${orgId}/${trackId}/docs/ok.pdf`, await tmpFile('ok.pdf', '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'));
    expect(await confirmRightsDocument(db, actor, good, store)).toEqual({ status: 'valid', error: null });

    const missing = await add(`${orgId}/${trackId}/docs/none.pdf`);
    expect((await confirmRightsDocument(db, actor, missing, store)).status).toBe('rejected');

    // another org cannot confirm this org's document
    const other = await makeSeller(db);
    await expect(confirmRightsDocument(db, { userId: other.owner.userId, orgId: other.orgId }, good, store)).rejects.toThrow(/Document not found/);
  });

  it('submit lists every unmet guard, then succeeds once they hold', async () => {
    const { owner, orgId } = await makeSeller(db);
    const actor: SellerActor = { userId: owner.userId, orgId };
    const trackId = await createTrack(db, actor, trackInput);
    const blocked = await submitTrack(db, actor, trackId);
    expect(blocked).toMatchObject({ ok: false });
    if (!blocked.ok) {
      expect(blocked.issues.join('|')).toMatch(/rights declaration/);
      expect(blocked.issues.join('|')).toMatch(/rights document/);
      expect(blocked.issues.join('|')).toMatch(/audio/);
      expect(blocked.issues.join('|')).toMatch(/seller agreement/);
    }
    expect((await trackRow(trackId)).status).toBe('draft');

    const d = await readyDraft();
    // audio still pending ingest -> not submittable yet
    const early = await submitTrack(db, d.actor, d.trackId);
    expect(early.ok).toBe(false);
    await processVersion(d.versionId, { store, screener: screener('clean') });
    expect((await submitTrack(db, d.actor, d.trackId)).ok).toBe(true);
    expect((await trackRow(d.trackId)).status).toBe('submitted');
  });

  it('blocks submit for a rejected seller and for unconfirmed warranties', async () => {
    const d = await readyDraft({ kyc: 'rejected' });
    await processVersion(d.versionId, { store, screener: screener('clean') });
    const r = await submitTrack(db, d.actor, d.trackId);
    expect(r.ok === false && r.issues.join('|')).toMatch(/verification was rejected/);

    const e = await readyDraft();
    await processVersion(e.versionId, { store, screener: screener('clean') });
    await saveRightsDeclaration(db, e.actor, e.trackId, { ...warranties, sampleFreeWarranted: false });
    const w = await submitTrack(db, e.actor, e.trackId);
    expect(w.ok === false && w.issues.join('|')).toMatch(/warranties/);
  });
});

describe('pipeline', () => {
  it('moves a submitted track to review only after ingest and screening; the sweep finishes stragglers', async () => {
    const d = await readyDraft();
    expect(await processVersion(d.versionId, { store, screener: screener('clean') })).toMatchObject({ ingest: 'ready', screening: 'clean', movedToReview: false });
    await submitTrack(db, d.actor, d.trackId);
    expect((await trackRow(d.trackId)).status).toBe('submitted');
    // the sweep (cron backstop) picks the submitted track up and moves it on without redoing work
    expect(await sweepCatalog(50, { store, screener: screener('clean') })).toBeGreaterThanOrEqual(1);
    expect((await trackRow(d.trackId)).status).toBe('in_review');
    const events = await db.select().from(trackEvents).where(eq(trackEvents.trackId, d.trackId)).orderBy(trackEvents.at);
    expect(events.map((e) => e.event)).toEqual(['submit', 'ingest_screen_done']);
    expect(events[1]!.actorUserId).toBeNull();
  });
});

describe('approve guards', () => {
  it('screening match blocks approve without an override note; the note unblocks it and is audited', async () => {
    const d = await inReview('match');
    const admin = await makeUser(db, { admin: ['verification'], aal: 'aal2' });
    await probe(admin, d.versionId);

    const blocked = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L2' });
    expect(blocked.ok === false && blocked.issues.join('|')).toMatch(/Screening found a match/);
    const short = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L2', overrideNote: 'ok' });
    expect(short.ok).toBe(false);
    expect((await trackRow(d.trackId)).status).toBe('in_review');

    const done = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L2', overrideNote: 'Different recording; cleared with the label by email' });
    expect(done.ok).toBe(true);
    const t = await trackRow(d.trackId);
    expect(t).toMatchObject({ status: 'published', clearanceClass: 'A', priceLevel: 'L2', currentVersionId: d.versionId });
    expect(t.publishedAt).toBeInstanceOf(Date);
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, d.trackId), eq(auditLog.action, 'track.approve')));
    const [scr] = await db.select().from(screenings).where(eq(screenings.trackVersionId, d.versionId));
    expect(audit!.after).toMatchObject({ screeningId: scr!.id, screeningStatus: 'match', overrideNote: expect.stringContaining('Different recording') });
  });

  it('needs a claim probe, a price level and the verification permission', async () => {
    const d = await inReview('clean');
    const admin = await makeUser(db, { admin: ['verification'], aal: 'aal2' });
    const noProbe = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L1' });
    expect(noProbe.ok === false && noProbe.issues.join('|')).toMatch(/claim probe/);
    await probe(admin, d.versionId);
    const badPrice = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L9' as never });
    expect(badPrice.ok).toBe(false);
    await expect(approveTrack(db, adminCtx(admin, ['finance']), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L1' })).rejects.toThrow(/verification/);
    expect((await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L1' })).ok).toBe(true);
    // a second approve finds the track already published
    const again = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L1' });
    expect(again.ok).toBe(false);
  });

  it('class B needs the seller’s accepted release commitment and an ops contact', async () => {
    const d = await inReview('clean');
    const admin = await makeUser(db, { admin: ['verification'], aal: 'aal2' });
    await probe(admin, d.versionId);
    const noCommit = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'B', priceLevel: 'L3' });
    expect(noCommit.ok === false && noCommit.issues.join('|')).toMatch(/release commitment/);
    await acceptAgreement('release_commitment', d.orgId, d.owner.userId);
    const ok = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'B', priceLevel: 'L3' });
    expect(ok.ok).toBe(true);
    expect((await trackRow(d.trackId)).clearanceClass).toBe('B');

    const noOps = await makeSeller(db, { opsEmail: null });
    const trackId = await makeTrack(db, noOps.orgId, 'in_review');
    const [v] = await db.insert(trackVersions).values({ trackId, versionNo: 1, masterKey: 'x.wav', ingestStatus: 'ready' }).returning({ id: trackVersions.id });
    await db.insert(screenings).values({ trackVersionId: v!.id, provider: 'fake', status: 'clean' });
    await probe(admin, v!.id);
    await acceptAgreement('release_commitment', noOps.orgId, noOps.owner.userId);
    const r = await approveTrack(db, adminCtx(admin), { trackId, clearanceClass: 'B', priceLevel: 'L3' });
    expect(r.ok === false && r.issues.join('|')).toMatch(/ops contact/);
  });

  it('an errored or unfinished screening blocks approval even with a note', async () => {
    const d = await inReview('clean');
    await db.update(screenings).set({ status: 'error' }).where(eq(screenings.trackVersionId, d.versionId));
    const admin = await makeUser(db, { admin: ['verification'], aal: 'aal2' });
    await probe(admin, d.versionId);
    const r = await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L1', overrideNote: 'please publish this anyway' });
    expect(r.ok === false && r.issues.join('|')).toMatch(/Screening has not finished/);
  });
});

describe('reject, availability and resubmit', () => {
  it('reject needs a reason, writes audit, and the seller can edit and resubmit; class C records the class', async () => {
    const d = await inReview('clean');
    const admin = await makeUser(db, { admin: ['verification'], aal: 'aal2' });
    await expect(rejectTrack(db, adminCtx(admin), { trackId: d.trackId, reason: '  ' })).rejects.toThrow(/reason/);
    const rej = await rejectTrack(db, adminCtx(admin), { trackId: d.trackId, reason: 'Registered with another distributor' });
    expect(rej).toMatchObject({ ok: true, to: 'rejected' });
    expect(await trackRow(d.trackId)).toMatchObject({ status: 'rejected', rejectionReason: 'Registered with another distributor' });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, d.trackId), eq(auditLog.action, 'track.reject')))).toHaveLength(1);

    expect(await editTrack(db, d.actor, d.trackId)).toMatchObject({ ok: true, to: 'draft' });
    await updateTrack(db, d.actor, d.trackId, { ...trackInput, title: 'Fixed' });

    const c = await inReview('clean');
    expect(await rejectTrack(db, adminCtx(admin), { trackId: c.trackId, reason: 'Cannot be cleared', classC: true })).toMatchObject({ ok: true });
    expect(await trackRow(c.trackId)).toMatchObject({ status: 'rejected', clearanceClass: 'C' });
  });

  it('suspend, reinstate and delist keep to the table; sellers can only delist their own', async () => {
    const d = await inReview('clean');
    const admin = await makeUser(db, { admin: ['verification'], aal: 'aal2' });
    await probe(admin, d.versionId);
    await approveTrack(db, adminCtx(admin), { trackId: d.trackId, clearanceClass: 'A', priceLevel: 'L1' });

    expect(await setTrackAvailability(db, adminCtx(admin), { trackId: d.trackId, action: 'suspend', reason: 'Claim received' })).toMatchObject({ ok: true, to: 'suspended' });
    expect(await setTrackAvailability(db, adminCtx(admin), { trackId: d.trackId, action: 'suspend', reason: 'again' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await setTrackAvailability(db, adminCtx(admin), { trackId: d.trackId, action: 'reinstate', reason: 'Resolved' })).toMatchObject({ ok: true, to: 'published' });

    const stranger = await makeSeller(db);
    await expect(delistOwnTrack(db, { userId: stranger.owner.userId, orgId: stranger.orgId }, d.trackId)).rejects.toThrow(/Track not found/);
    expect(await delistOwnTrack(db, d.actor, d.trackId)).toMatchObject({ ok: true, to: 'delisted' });
  });
});

async function probe(admin: { userId: string }, versionId: string) {
  return recordClaimProbe(db, adminCtx(admin), { versionId, platform: 'youtube', claims: [] });
}
