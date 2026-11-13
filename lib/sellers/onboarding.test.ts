import { writeFile } from 'node:fs/promises';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { auditLog, sellerDocuments, sellerProfiles } from '@/db/schema';
import { listSellerOrgs } from '@/lib/identity/server';
import { getCurrentDocument, publishLegalDocument } from '@/lib/legal/server';
import { closeDb, getDb } from '@/lib/platform/db';
import { decrypt } from '@/lib/platform/crypto';
import { ObjectNotFoundError, type ObjectStore } from '@/lib/platform/storage';
import { makeBuyer, makeSeller, makeUser } from '@/tests/factories';
import {
  acceptSellerTerms,
  confirmSellerDocument,
  createSellerAccount,
  getOnboardingStatus,
  listSellerDocuments,
  OnboardingError,
  requestSellerDocumentUpload,
  sellerDocumentDownloadUrl,
  setKycStatus,
  setSellerPan,
  updateSellerProfile,
} from './server';

// The signed-URL calls need a live Supabase Storage; everything else here is real Postgres.
vi.mock('@/lib/platform/storage', async (orig) => ({
  ...(await orig<typeof import('@/lib/platform/storage')>()),
  createSignedUploadUrl: async () => ({ signedUrl: 'https://storage.test/upload', token: 't' }),
  createSignedDownloadUrl: async (_b: string, key: string) => `https://storage.test/download/${key}`,
}));

afterAll(closeDb);
const db = getDb();

const files = new Map<string, Buffer>();
const store: ObjectStore = {
  async downloadToFile(bucket, key, dest) {
    const data = files.get(`${bucket}/${key}`);
    if (!data) throw new ObjectNotFoundError(bucket, key);
    await writeFile(dest, data);
  },
  async upload() {},
};
const pdf = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n${' '.repeat(80)}\n%%EOF\n`, 'latin1');

const newSeller = (over: Record<string, unknown> = {}) => ({
  legalName: 'Moonrise Records Pvt Ltd',
  displayName: 'Moonrise',
  entityType: 'company' as const,
  opsContactEmail: 'ops@moonrise.example',
  worldwideRightsWarranted: true as const,
  ...over,
});
const verifier = async (permissions: ('verification' | 'finance')[] = ['verification']) => ({ userId: (await makeUser(db, { admin: permissions, aal: 'aal2' })).userId, permissions });
const err = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

async function uploaded(orgId: string, session: Awaited<ReturnType<typeof makeUser>>, bytes: Buffer, kind: 'pan_card' | 'id_proof' = 'pan_card', mime = 'application/pdf') {
  const { documentId } = await requestSellerDocumentUpload(db, session, orgId, { kind, mime });
  const [row] = await db.select().from(sellerDocuments).where(eq(sellerDocuments.id, documentId));
  files.set(`documents/${row!.fileKey}`, bytes);
  return documentId;
}

describe('creating the seller account', () => {
  it('a verified user gets a seller org, owner membership and a profile; the worldwide warranty is mandatory', async () => {
    const me = await makeUser(db);
    const { orgId } = await createSellerAccount(db, me, newSeller({ gstin: '27AAPFU0939F1ZV' }));
    const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, orgId));
    expect(p).toMatchObject({ entityType: 'company', gstRegistered: true, gstin: '27AAPFU0939F1ZV', kycStatus: 'pending', worldwideRightsWarranted: true, onboardingMode: 'self_serve' });
    expect((await getOnboardingStatus(db, me, orgId))!.profile).toBe(true);

    expect(await err(createSellerAccount(db, me, newSeller({ worldwideRightsWarranted: false })))).not.toBeNull();
    expect(await err(createSellerAccount(db, me, newSeller({ gstin: 'NOT-A-GSTIN' })))).not.toBeNull();
    expect(await err(createSellerAccount(db, me, newSeller({ opsContactEmail: 'nope' })))).not.toBeNull();
    expect(await err(createSellerAccount(db, await makeUser(db, { verified: false }), newSeller()))).toMatchObject({ message: 'unverified' });
  });

  it('a user gets one seller org', async () => {
    const me = await makeUser(db);
    await createSellerAccount(db, me, newSeller());
    expect(await err(createSellerAccount(db, me, newSeller()))).toMatchObject({ message: 'You already have a seller account.' });
    expect(await listSellerOrgs(db, me.userId)).toHaveLength(1);
  });

  it('only the owner edits the profile; a blank GSTIN clears the registration flag', async () => {
    const s = await makeSeller(db);
    await updateSellerProfile(db, s.owner, s.orgId, { entityType: 'llp', opsContactEmail: 'new@seller.example', gstin: '29ABCDE1234F1Z5' });
    expect(((await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, s.orgId)))[0])).toMatchObject({ entityType: 'llp', gstRegistered: true, opsContactEmail: 'new@seller.example' });
    await updateSellerProfile(db, s.owner, s.orgId, { entityType: 'llp', opsContactEmail: 'new@seller.example', gstin: '' });
    expect(((await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, s.orgId)))[0])).toMatchObject({ gstRegistered: false, gstin: null });
    const stranger = await makeUser(db);
    expect(await err(updateSellerProfile(db, stranger, s.orgId, { entityType: 'llp', opsContactEmail: 'x@y.example' }))).toMatchObject({ message: 'forbidden' });
  });
});

describe('PAN', () => {
  it('is stored encrypted and audited masked; it needs a TOTP session and the owner; a verified seller goes back to review', async () => {
    const s = await makeSeller(db, { kyc: 'verified' });
    const owner2fa = { ...s.owner, aal: 'aal2' as const };
    expect(await err(setSellerPan(db, s.owner, s.orgId, 'ABCDE1234F'))).toMatchObject({ message: 'mfa_required' });
    expect(await err(setSellerPan(db, { ...(await makeUser(db)), aal: 'aal2' }, s.orgId, 'ABCDE1234F'))).toMatchObject({ message: 'forbidden' });
    expect(await err(setSellerPan(db, owner2fa, s.orgId, 'bad-pan'))).not.toBeNull();

    await setSellerPan(db, owner2fa, s.orgId, ' abcde1234f ', { ip: '203.0.113.9' });
    const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, s.orgId));
    expect(p!.panEncrypted).not.toContain('ABCDE1234F');
    expect(decrypt(p!.panEncrypted!)).toBe('ABCDE1234F');
    expect(p!.kycStatus).toBe('pending');

    const rejected = await makeSeller(db, { kyc: 'rejected' }); // re-entering a PAN does not undo a rejection
    await setSellerPan(db, { ...rejected.owner, aal: 'aal2' }, rejected.orgId, 'ABCDE1234F');
    expect((await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, rejected.orgId)))[0]!.kycStatus).toBe('rejected');
    const [a] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, s.orgId), eq(auditLog.action, 'seller.pan_set')));
    expect(JSON.stringify(a!.after)).not.toContain('ABCDE1234F');
    expect(JSON.stringify(a!.after)).toContain('234F');
  });
});

describe('upload throttle', () => {
  it('refuses a new signed upload link once the user has used their allowance, and counts per user', async () => {
    const s = await makeSeller(db);
    await db.execute(sql`INSERT INTO rate_limits (key, tokens, updated_at) VALUES (${'upload:' + s.owner.userId}, 0, now())`);
    expect(await err(requestSellerDocumentUpload(db, s.owner, s.orgId, { kind: 'id_proof', mime: 'application/pdf' }))).toMatchObject({ message: expect.stringContaining('Too many uploads in a short time') });
    expect(await db.select().from(sellerDocuments).where(eq(sellerDocuments.sellerOrgId, s.orgId))).toHaveLength(0); // no row for a refused link
    const other = await makeSeller(db);
    await expect(requestSellerDocumentUpload(db, other.owner, other.orgId, { kind: 'id_proof', mime: 'application/pdf' })).resolves.toBeTruthy();
  });
});

describe('KYC documents', () => {
  it('are checked on confirm (valid / rejected), listed without storage keys, and invisible to other orgs', async () => {
    const s = await makeSeller(db);
    const good = await uploaded(s.orgId, s.owner, pdf);
    const bad = await uploaded(s.orgId, s.owner, Buffer.from('MZ-not-a-pdf'.padEnd(100, 'x')), 'id_proof');
    expect(await confirmSellerDocument(db, s.owner, good, store)).toEqual({ status: 'valid', error: null });
    expect(await confirmSellerDocument(db, s.owner, bad, store)).toMatchObject({ status: 'rejected' });
    const missing = (await requestSellerDocumentUpload(db, s.owner, s.orgId, { kind: 'bank_proof', mime: 'image/png' })).documentId;
    expect(await confirmSellerDocument(db, s.owner, missing, store)).toMatchObject({ status: 'rejected', error: expect.stringContaining('not found') });

    const list = await listSellerDocuments(db, s.owner, s.orgId);
    expect(list.map((d) => d.status)).toEqual(['valid', 'rejected', 'rejected']);
    expect(JSON.stringify(list)).not.toContain(s.orgId); // no storage keys in what the seller sees
    expect(await getOnboardingStatus(db, s.owner, s.orgId)).toMatchObject({ documents: { valid: 1, pending: 0, rejected: 2, panCardValid: true } });
    const [badRow] = await db.select().from(sellerDocuments).where(eq(sellerDocuments.id, bad));
    files.set(`documents/${badRow!.fileKey}`, pdf); // swapping the file after the verdict changes nothing
    expect(await confirmSellerDocument(db, s.owner, bad, store)).toMatchObject({ status: 'rejected' });

    const other = await makeSeller(db);
    expect(await err(listSellerDocuments(db, other.owner, s.orgId))).toMatchObject({ message: 'forbidden' });
    expect(await err(getOnboardingStatus(db, other.owner, s.orgId))).toMatchObject({ message: 'forbidden' });
    expect(await err(confirmSellerDocument(db, other.owner, good, store))).toMatchObject({ message: 'forbidden' });
    expect(await err(requestSellerDocumentUpload(db, other.owner, s.orgId, { kind: 'pan_card', mime: 'application/pdf' }))).toMatchObject({ message: 'forbidden' });
    expect(await err(requestSellerDocumentUpload(db, s.owner, s.orgId, { kind: 'pan_card', mime: 'application/zip' }))).toBeInstanceOf(OnboardingError);
  });

  it('an org holds at most 20 upload rows', async () => {
    const s = await makeSeller(db);
    for (let i = 0; i < 20; i++) await requestSellerDocumentUpload(db, s.owner, s.orgId, { kind: 'id_proof', mime: 'application/pdf' });
    expect(await err(requestSellerDocumentUpload(db, s.owner, s.orgId, { kind: 'id_proof', mime: 'application/pdf' }))).toBeInstanceOf(OnboardingError);
  });

  it('the database never deletes a document or changes anything but the validation result', async () => {
    const s = await makeSeller(db);
    const id = await uploaded(s.orgId, s.owner, pdf);
    expect(await err(db.execute(sql`DELETE FROM seller_documents WHERE id = ${id}`))).not.toBeNull();
    expect(await err(db.execute(sql`UPDATE seller_documents SET kind = 'id_proof' WHERE id = ${id}`))).not.toBeNull();
    expect(await err(db.execute(sql`UPDATE seller_documents SET validation_status = 'valid' WHERE id = ${id}`))).toBeNull();
  });
});

describe('agreements and progress', () => {
  it('the owner accepts the current seller agreement and release commitment; the checklist follows', async () => {
    const sa = await makeUser(db, { admin: ['superadmin'], aal: 'aal2' });
    for (const kind of ['seller_agreement', 'release_commitment'] as const) {
      if (!(await getCurrentDocument(db, kind))) await publishLegalDocument(db, { userId: sa.userId, permissions: ['superadmin'] }, { kind, bodyMarkdown: `${kind} text` });
    }
    const s = await makeSeller(db);
    expect(await getOnboardingStatus(db, s.owner, s.orgId)).toMatchObject({ sellerAgreement: false, releaseCommitment: false, readyToSubmit: false, bank: 'missing', pan: false, kycStatus: 'verified' });
    expect(await err(acceptSellerTerms(db, await makeUser(db), s.orgId, ['seller_agreement']))).toMatchObject({ message: 'forbidden' });
    await acceptSellerTerms(db, s.owner, s.orgId, ['seller_agreement'], { ip: '203.0.113.5' });
    await acceptSellerTerms(db, s.owner, s.orgId, ['seller_agreement']); // twice is a no-op
    expect(await getOnboardingStatus(db, s.owner, s.orgId)).toMatchObject({ sellerAgreement: true, releaseCommitment: false, readyToSubmit: true });
    await acceptSellerTerms(db, s.owner, s.orgId, ['release_commitment']);
    expect((await getOnboardingStatus(db, s.owner, s.orgId))!.releaseCommitment).toBe(true);

    const rejected = await makeSeller(db, { kyc: 'rejected' });
    await acceptSellerTerms(db, rejected.owner, rejected.orgId, ['seller_agreement']);
    expect((await getOnboardingStatus(db, rejected.owner, rejected.orgId))!.readyToSubmit).toBe(false); // KYC rejected blocks submission
  });

  it('an org that is not a seller has no onboarding status', async () => {
    const buyer = await makeBuyer(db);
    expect(await getOnboardingStatus(db, buyer.owner, buyer.orgId)).toBeNull();
  });
});

describe('admin KYC review', () => {
  it('needs the verification permission; verifying needs a PAN and a valid document; both outcomes are audited', async () => {
    const me = await makeUser(db, { aal: 'aal2' });
    const { orgId } = await createSellerAccount(db, me, newSeller());
    await expect(setKycStatus(db, await verifier(['finance']), orgId, 'verified', 'ok')).rejects.toThrow(/verification/);
    const admin = await verifier();
    await expect(setKycStatus(db, admin, orgId, 'verified', '  ')).rejects.toThrow(/note/);
    expect(await setKycStatus(db, admin, orgId, 'verified', 'looks fine')).toEqual({ ok: false, reason: 'incomplete' });

    await setSellerPan(db, me, orgId, 'ABCDE1234F');
    expect(await setKycStatus(db, admin, orgId, 'verified', 'looks fine')).toEqual({ ok: false, reason: 'incomplete' }); // still no valid document
    await confirmSellerDocument(db, me, await uploaded(orgId, me, pdf, 'id_proof'), store);
    expect(await setKycStatus(db, admin, orgId, 'verified', 'looks fine')).toEqual({ ok: false, reason: 'incomplete' }); // an ID alone is not the PAN card
    const doc = await uploaded(orgId, me, pdf);
    await confirmSellerDocument(db, me, doc, store);
    expect(await setKycStatus(db, admin, orgId, 'verified', 'PAN card matches')).toEqual({ ok: true });
    expect((await getOnboardingStatus(db, me, orgId))!.kycStatus).toBe('verified');
    expect(await setKycStatus(db, admin, orgId, 'rejected', 'name mismatch')).toEqual({ ok: true });
    expect(await setKycStatus(db, admin, '00000000-0000-7000-8000-000000000000', 'rejected', 'x')).toEqual({ ok: false, reason: 'not_found' });
    expect(await setKycStatus(db, admin, orgId, 'pending', 'seller sent a new document')).toEqual({ ok: true }); // only an admin re-opens a rejection
    expect((await getOnboardingStatus(db, me, orgId))!.kycStatus).toBe('pending');
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, orgId), sql`${auditLog.action} like 'seller.kyc_%'`))).toHaveLength(3);

    expect(await sellerDocumentDownloadUrl(db, admin, doc)).toContain(`/download/${orgId}/kyc/`);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.entityId, doc), eq(auditLog.action, 'seller_document.download')))).toHaveLength(1);
    await expect(sellerDocumentDownloadUrl(db, await verifier(['finance']), doc)).rejects.toThrow(/verification/);
    const pendingDoc = (await requestSellerDocumentUpload(db, me, orgId, { kind: 'id_proof', mime: 'application/pdf' })).documentId;
    await expect(sellerDocumentDownloadUrl(db, admin, pendingDoc)).rejects.toThrow(/validated/);
  });
});
