import { and, asc, eq, sql } from 'drizzle-orm';
import { payoutAccounts, sellerDocuments, sellerProfiles } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext, type Session } from '@/lib/identity';
import { createOrganization, getMembershipRole, listSellerOrgs, requireAal2, requireVerified } from '@/lib/identity/server';
import { getCurrentDocument, hasOrgAccepted, recordAcceptance } from '@/lib/legal/server';
import { decrypt, encrypt, maskTail } from '@/lib/platform/crypto';
import type { DbOrTx } from '@/lib/platform/db';
import { DOCUMENT_MIME_TYPES, type DocumentMime } from '@/lib/platform/document-validation';
import { uuidv7 } from '@/lib/platform/ids';
import { BUCKETS, createSignedDownloadUrl, createSignedUploadUrl, supabaseObjectStore, type ObjectStore } from '@/lib/platform/storage';
import { DOC_EXTENSIONS, validateStoredDocument } from '@/lib/platform/stored-document';
import {
  newSellerInputSchema,
  panSchema,
  sellerProfileInputSchema,
  type EntityType,
  type KycDocKind,
  type KycStatus,
} from '../index';

export class OnboardingError extends Error {}

/** Upload rows an org may hold (rows are never deleted); stops an owner minting unlimited pending rows. */
const MAX_DOCUMENTS = 20;

type Ctx = { ip?: string | null };

/** The seller org's owner acting through a verified session. Members may see onboarding but not change it. */
async function requireOwner(db: DbOrTx, session: Session, orgId: string): Promise<void> {
  const g = requireVerified(session);
  if (!g.ok) throw new OnboardingError(g.reason);
  if ((await getMembershipRole(db, session.userId, orgId)) !== 'owner') throw new OnboardingError('forbidden');
}

/**
 * Self-serve onboarding step 1: the signed-in user creates their seller organisation and its profile in one
 * transaction (PLAN §3.2). They become its owner. The worldwide-rights warranty is mandatory. One seller org per
 * user: the seller pages act for a single org, so a second one would be unreachable.
 */
export async function createSellerAccount(db: DbOrTx, session: Session, raw: unknown): Promise<{ orgId: string }> {
  const g = requireVerified(session);
  if (!g.ok) throw new OnboardingError(g.reason);
  const input = newSellerInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`seller-org:${session.userId}`}))`); // two clicks, one org
    if ((await listSellerOrgs(tx, session.userId)).length > 0) throw new OnboardingError('You already have a seller account.');
    const orgId = await createOrganization(tx, session.userId, { kind: 'seller', legalName: input.legalName, displayName: input.displayName });
    await tx.insert(sellerProfiles).values({
      orgId,
      entityType: input.entityType,
      gstin: input.gstin ?? null,
      gstRegistered: Boolean(input.gstin),
      opsContactEmail: input.opsContactEmail,
      opsContactPhone: input.opsContactPhone ?? null,
      worldwideRightsWarranted: true,
    });
    return { orgId };
  });
}

/** Owner edits entity type, GSTIN and the ops contact (where clearance requests go). */
export async function updateSellerProfile(db: DbOrTx, session: Session, orgId: string, raw: unknown): Promise<void> {
  await requireOwner(db, session, orgId);
  const input = sellerProfileInputSchema.parse(raw);
  const updated = await db
    .update(sellerProfiles)
    .set({
      entityType: input.entityType,
      gstin: input.gstin ?? null,
      gstRegistered: Boolean(input.gstin),
      opsContactEmail: input.opsContactEmail,
      opsContactPhone: input.opsContactPhone ?? null,
    })
    .where(eq(sellerProfiles.orgId, orgId))
    .returning({ orgId: sellerProfiles.orgId });
  if (updated.length === 0) throw new OnboardingError('not_found');
}

/**
 * Stores the PAN encrypted (displayed masked everywhere). A tax identity change needs a recent TOTP session like a
 * payout-detail change, and sends a verified seller back to KYC review. A rejected seller stays rejected: only an
 * admin re-opens the review (`setKycStatus(..., 'pending')`), otherwise a rejection could be undone by re-entering a PAN.
 */
export async function setSellerPan(db: DbOrTx, session: Session, orgId: string, rawPan: string, ctx: Ctx = {}): Promise<void> {
  const guard = requireAal2(session);
  if (!guard.ok) throw new OnboardingError(guard.reason);
  await requireOwner(db, session, orgId);
  const pan = panSchema.parse(rawPan);
  await db.transaction(async (tx) => {
    const updated = await tx.update(sellerProfiles).set({ panEncrypted: encrypt(pan), kycStatus: sql`case when ${sellerProfiles.kycStatus} = 'verified' then 'pending' else ${sellerProfiles.kycStatus} end` }).where(eq(sellerProfiles.orgId, orgId)).returning({ orgId: sellerProfiles.orgId });
    if (updated.length === 0) throw new OnboardingError('not_found');
    await writeAudit(tx, { actorUserId: session.userId, action: 'seller.pan_set', entityType: 'seller_org', entityId: orgId, after: { pan: maskTail(pan) }, ip: ctx.ip });
  });
}

// ---- KYC documents ----

export async function requestSellerDocumentUpload(db: DbOrTx, session: Session, orgId: string, input: { kind: KycDocKind; mime: string }) {
  await requireOwner(db, session, orgId);
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(input.mime)) throw new OnboardingError('Documents must be PDF, JPG or PNG');
  const [held] = await db.select({ n: sql<number>`count(*)::int` }).from(sellerDocuments).where(eq(sellerDocuments.sellerOrgId, orgId));
  if (held!.n >= MAX_DOCUMENTS) throw new OnboardingError('Too many uploads. Contact support if you need to add more.');
  const id = uuidv7();
  const key = `${orgId}/kyc/${id}.${DOC_EXTENSIONS[input.mime as DocumentMime]}`;
  await db.insert(sellerDocuments).values({ id, sellerOrgId: orgId, kind: input.kind, declaredMime: input.mime, fileKey: key, uploadedBy: session.userId });
  const signed = await createSignedUploadUrl(BUCKETS.documents, key);
  return { documentId: id, key, signedUrl: signed.signedUrl, token: signed.token };
}

/** Downloads what was uploaded and applies the F9 checks; the result is stored, the file stays private. */
export async function confirmSellerDocument(db: DbOrTx, session: Session, documentId: string, store: ObjectStore = supabaseObjectStore) {
  const [doc] = await db.select().from(sellerDocuments).where(eq(sellerDocuments.id, documentId));
  if (!doc) throw new OnboardingError('not_found');
  await requireOwner(db, session, doc.sellerOrgId);
  if (doc.validationStatus !== 'pending') return { status: doc.validationStatus, error: doc.validationError }; // decided once
  const { status, error, size } = await validateStoredDocument(store, doc.fileKey, doc.declaredMime);
  await db.update(sellerDocuments).set({ validationStatus: status, validationError: error, sizeBytes: size }).where(eq(sellerDocuments.id, documentId));
  return { status, error };
}

/** The org's documents, without storage keys. Any member of the org may look. */
export async function listSellerDocuments(db: DbOrTx, session: Session, orgId: string) {
  if (!(await getMembershipRole(db, session.userId, orgId))) throw new OnboardingError('forbidden');
  return db
    .select({ id: sellerDocuments.id, kind: sellerDocuments.kind, status: sellerDocuments.validationStatus, error: sellerDocuments.validationError, uploadedAt: sellerDocuments.uploadedAt })
    .from(sellerDocuments)
    .where(eq(sellerDocuments.sellerOrgId, orgId))
    .orderBy(asc(sellerDocuments.uploadedAt));
}

// ---- agreements ----

export const SELLER_TERMS = ['seller_agreement', 'release_commitment'] as const;
export type SellerTerm = (typeof SELLER_TERMS)[number];

/** Owner accepts the current version of the seller agreement and/or the Class B release commitment for the org. */
export async function acceptSellerTerms(db: DbOrTx, session: Session, orgId: string, kinds: readonly SellerTerm[], meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<void> {
  await requireOwner(db, session, orgId);
  await db.transaction(async (tx) => {
    for (const kind of kinds) {
      const doc = await getCurrentDocument(tx, kind);
      if (!doc) throw new OnboardingError(`${kind} is not published yet`);
      await recordAcceptance(tx, { userId: session.userId, orgId, documentId: doc.id, ip: meta.ip, userAgent: meta.userAgent });
    }
  });
}

// ---- progress ----

export type OnboardingStatus = {
  profile: boolean;
  pan: boolean;
  documents: { valid: number; pending: number; rejected: number; panCardValid: boolean };
  bank: 'missing' | 'unverified' | 'verified';
  sellerAgreement: boolean;
  releaseCommitment: boolean; // needed only to list Class B tracks
  kycStatus: KycStatus;
  /** Everything a seller must do before submitting a track (release commitment is separate: Class B only). */
  readyToSubmit: boolean;
};

export async function getOnboardingStatus(db: DbOrTx, session: Session, orgId: string): Promise<OnboardingStatus | null> {
  if (!(await getMembershipRole(db, session.userId, orgId))) throw new OnboardingError('forbidden');
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, orgId));
  if (!p) return null;
  const [docs] = await db
    .select({
      valid: sql<number>`count(*) filter (where ${sellerDocuments.validationStatus} = 'valid')::int`,
      pending: sql<number>`count(*) filter (where ${sellerDocuments.validationStatus} = 'pending')::int`,
      rejected: sql<number>`count(*) filter (where ${sellerDocuments.validationStatus} = 'rejected')::int`,
      panCardValid: sql<boolean>`coalesce(bool_or(${sellerDocuments.kind} = 'pan_card' and ${sellerDocuments.validationStatus} = 'valid'), false)`,
    })
    .from(sellerDocuments)
    .where(eq(sellerDocuments.sellerOrgId, orgId));
  const [bank] = await db.select({ verifiedAt: payoutAccounts.verifiedAt }).from(payoutAccounts).where(eq(payoutAccounts.sellerOrgId, orgId));
  const sellerAgreement = await hasOrgAccepted(db, orgId, 'seller_agreement');
  const releaseCommitment = await hasOrgAccepted(db, orgId, 'release_commitment');
  const kycStatus = p.kycStatus as KycStatus;
  return {
    profile: Boolean(p.opsContactEmail),
    pan: p.panEncrypted !== null,
    documents: docs!,
    bank: !bank ? 'missing' : bank.verifiedAt ? 'verified' : 'unverified',
    sellerAgreement,
    releaseCommitment,
    kycStatus,
    readyToSubmit: sellerAgreement && p.worldwideRightsWarranted && kycStatus !== 'rejected',
  };
}

// ---- admin KYC review (the admin pages arrive with S4-M10) ----

/**
 * Admin (`verification`) approves or rejects a seller's KYC, or re-opens a rejected one (`pending`). Approving needs a
 * PAN and a valid PAN-card document. Audited.
 */
export async function setKycStatus(db: DbOrTx, admin: AdminContext, orgId: string, outcome: KycStatus, note: string, ip?: string | null) {
  requirePermission(admin, 'verification');
  const reason = note.trim();
  if (!reason) throw new OnboardingError('A note is required');
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, orgId)).for('update');
    if (!p) return { ok: false as const, reason: 'not_found' as const };
    if (outcome === 'verified') {
      const [valid] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sellerDocuments)
        .where(and(eq(sellerDocuments.sellerOrgId, orgId), eq(sellerDocuments.kind, 'pan_card'), eq(sellerDocuments.validationStatus, 'valid')));
      if (!p.panEncrypted || !valid!.n) return { ok: false as const, reason: 'incomplete' as const };
    }
    await tx.update(sellerProfiles).set({ kycStatus: outcome }).where(eq(sellerProfiles.orgId, orgId));
    await writeAudit(tx, { actorUserId: admin.userId, action: `seller.kyc_${outcome}`, entityType: 'seller_org', entityId: orgId, before: { kycStatus: p.kycStatus }, after: { kycStatus: outcome, note: reason }, ip });
    return { ok: true as const };
  });
}

/** Admin download of a KYC document: short-lived signed URL forcing an attachment download (PLAN F9), audited. */
export async function sellerDocumentDownloadUrl(db: DbOrTx, admin: AdminContext, documentId: string, ip?: string | null): Promise<string> {
  requirePermission(admin, 'verification');
  const [doc] = await db.select().from(sellerDocuments).where(eq(sellerDocuments.id, documentId));
  if (!doc) throw new OnboardingError('not_found');
  if (doc.validationStatus !== 'valid') throw new OnboardingError('Only validated documents can be opened');
  await writeAudit(db, { actorUserId: admin.userId, action: 'seller_document.download', entityType: 'seller_document', entityId: doc.id, after: { sellerOrgId: doc.sellerOrgId, kind: doc.kind }, ip });
  return createSignedDownloadUrl(BUCKETS.documents, doc.fileKey, 900, `kyc-${doc.kind}-${doc.id}.${DOC_EXTENSIONS[doc.declaredMime as DocumentMime]}`);
}

/** The profile as the seller's own members see it; the PAN only ever masked. */
export async function getSellerProfile(db: DbOrTx, session: Session, orgId: string) {
  if (!(await getMembershipRole(db, session.userId, orgId))) throw new OnboardingError('forbidden');
  const [p] = await db.select().from(sellerProfiles).where(eq(sellerProfiles.orgId, orgId));
  if (!p) return null;
  return {
    entityType: p.entityType as EntityType,
    gstin: p.gstin,
    opsContactEmail: p.opsContactEmail,
    opsContactPhone: p.opsContactPhone,
    panMasked: p.panEncrypted ? maskTail(decrypt(p.panEncrypted)) : null,
  };
}
