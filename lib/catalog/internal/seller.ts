import { and, desc, eq, sql } from 'drizzle-orm';
import { rightsDeclarations, rightsDocuments, trackVersions, tracks } from '@/db/schema';
import { getMembershipRole } from '@/lib/identity/server';
import { getCurrentDocument, hasOrgAccepted } from '@/lib/legal/server';
import type { DbOrTx } from '@/lib/platform/db';
import type { DocumentMime } from '@/lib/platform/document-validation';
import { DOC_EXTENSIONS, validateStoredDocument } from '@/lib/platform/stored-document';
import { uuidv7 } from '@/lib/platform/ids';
import { BUCKETS, createSignedUploadUrl, supabaseObjectStore, type ObjectStore } from '@/lib/platform/storage';
import { getSellerStanding } from '@/lib/sellers/server';
import {
  rightsDeclarationSchema,
  trackInputSchema,
  type DocType,
  type GuardResult,
  type RightsDeclarationInput,
  type TrackInput,
} from '../index';
import { applyTransition } from './transition';

/** The caller as established by the action: a signed-in user acting for one of their organisations. */
export type SellerActor = { userId: string; orgId: string };

export class CatalogError extends Error {}

const AUDIO_EXTENSIONS = ['wav', 'mp3'] as const;

/** Membership check (org ids from the client are inputs to verify) plus the track belongs to that org. */
async function ownTrack(db: DbOrTx, actor: SellerActor, trackId: string) {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) throw new CatalogError('Not a member of this organisation');
  const [track] = await db.select().from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.sellerOrgId, actor.orgId)));
  if (!track) throw new CatalogError('Track not found');
  return track;
}

function slugify(title: string) {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'track'}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTrack(db: DbOrTx, actor: SellerActor, input: TrackInput): Promise<string> {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) throw new CatalogError('Not a member of this organisation');
  const standing = await getSellerStanding(db, actor.orgId);
  if (!standing) throw new CatalogError('Complete seller onboarding before adding tracks');
  const data = trackInputSchema.parse(input);
  const [row] = await db.insert(tracks).values({ ...data, sellerOrgId: actor.orgId, slug: slugify(data.title) }).returning({ id: tracks.id });
  return row!.id;
}

/** Metadata is editable while the track is a draft (a rejected track returns to draft via `editTrack`). */
export async function updateTrack(db: DbOrTx, actor: SellerActor, trackId: string, input: TrackInput): Promise<void> {
  const track = await ownTrack(db, actor, trackId);
  if (track.status !== 'draft') throw new CatalogError('Only draft tracks can be edited');
  await db.update(tracks).set({ ...trackInputSchema.parse(input), updatedAt: new Date() }).where(and(eq(tracks.id, trackId), eq(tracks.status, 'draft')));
}

/** A rejected track goes back to draft for changes; resubmits are unlimited. */
export async function editTrack(db: DbOrTx, actor: SellerActor, trackId: string) {
  const track = await ownTrack(db, actor, trackId);
  if (track.clearanceClass === 'C') throw new CatalogError('This track was classified as not clearable and cannot be resubmitted');
  return applyTransition(db, trackId, 'edit', actor.userId);
}

export async function saveRightsDeclaration(db: DbOrTx, actor: SellerActor, trackId: string, input: RightsDeclarationInput): Promise<void> {
  await ownTrack(db, actor, trackId);
  const data = rightsDeclarationSchema.parse(input);
  const agreement = await getCurrentDocument(db, 'seller_agreement');
  await db.transaction(async (tx) => {
    // lock the row, then re-check: the track may have been submitted since ownTrack read it
    const [locked] = await tx.execute<{ status: string }>(sql`SELECT status FROM tracks WHERE id = ${trackId} FOR UPDATE`);
    if (locked?.status !== 'draft') throw new CatalogError('Rights can only be declared on a draft track');
    const values = { ...data, acceptedDocumentId: agreement?.id ?? null, declaredAt: new Date() };
    await tx.insert(rightsDeclarations).values({ trackId, ...values }).onConflictDoUpdate({ target: rightsDeclarations.trackId, set: values });
  });
}

// ---- master upload ----

/**
 * Step 1: allocates the version id and a signed upload URL for the exact storage path. Nothing is stored
 * in the database yet, so an abandoned upload leaves no pending version for the sweep to trip over.
 */
export async function requestMasterUpload(db: DbOrTx, actor: SellerActor, trackId: string, ext: string) {
  const track = await ownTrack(db, actor, trackId);
  const extension = ext.toLowerCase().replace(/^\./, '');
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(extension)) throw new CatalogError('Upload a WAV or MP3 file');
  if (track.status !== 'draft') throw new CatalogError('Audio can only be replaced on a draft track');
  const versionId = uuidv7();
  const key = masterKey(actor.orgId, trackId, versionId, extension);
  const signed = await createSignedUploadUrl(BUCKETS.masters, key);
  return { versionId, key, signedUrl: signed.signedUrl, token: signed.token };
}

const masterKey = (orgId: string, trackId: string, versionId: string, ext: string) => `${orgId}/${trackId}/${versionId}.${ext}`;

/** Step 2: the client finished uploading. Creates the pending version (idempotent) for the caller to kick `processVersion`. */
export async function confirmMasterUpload(db: DbOrTx, actor: SellerActor, trackId: string, versionId: string, ext: string): Promise<string> {
  const track = await ownTrack(db, actor, trackId);
  if (track.status !== 'draft') throw new CatalogError('Audio can only be replaced on a draft track');
  const extension = ext.toLowerCase().replace(/^\./, '');
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(extension)) throw new CatalogError('Upload a WAV or MP3 file');
  const key = masterKey(actor.orgId, trackId, versionId, extension);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM tracks WHERE id = ${trackId} FOR UPDATE`); // serialises version numbering per track
    const [last] = await tx
      .select({ n: trackVersions.versionNo })
      .from(trackVersions)
      .where(eq(trackVersions.trackId, trackId))
      .orderBy(desc(trackVersions.versionNo))
      .limit(1);
    await tx
      .insert(trackVersions)
      .values({ id: versionId, trackId, versionNo: (last?.n ?? 0) + 1, masterKey: key })
      .onConflictDoNothing({ target: trackVersions.id });
    // the id came from the client: if it already exists it must be this track's own version, never someone else's
    const [existing] = await tx.select({ trackId: trackVersions.trackId }).from(trackVersions).where(eq(trackVersions.id, versionId));
    if (existing?.trackId !== trackId) throw new CatalogError('Invalid upload');
  });
  return versionId;
}

// ---- rights documents (F9) ----

export async function requestRightsDocumentUpload(
  db: DbOrTx,
  actor: SellerActor,
  trackId: string,
  input: { docType: DocType; mime: string },
) {
  const track = await ownTrack(db, actor, trackId);
  if (track.status !== 'draft') throw new CatalogError('Documents can only be added to a draft track');
  const ext = DOC_EXTENSIONS[input.mime as DocumentMime];
  if (!ext) throw new CatalogError('Documents must be PDF, JPG or PNG');
  const id = uuidv7();
  const key = `${actor.orgId}/${trackId}/docs/${id}.${ext}`;
  await db.insert(rightsDocuments).values({ id, trackId, sellerOrgId: actor.orgId, docType: input.docType, declaredMime: input.mime, fileKey: key });
  const signed = await createSignedUploadUrl(BUCKETS.documents, key);
  return { documentId: id, key, signedUrl: signed.signedUrl, token: signed.token };
}

/** Downloads what was uploaded and applies the F9 checks (size, magic bytes vs declared type, PDF active content...). */
export async function confirmRightsDocument(db: DbOrTx, actor: SellerActor, documentId: string, store: ObjectStore = supabaseObjectStore) {
  const [doc] = await db.select().from(rightsDocuments).where(and(eq(rightsDocuments.id, documentId), eq(rightsDocuments.sellerOrgId, actor.orgId)));
  if (!doc) throw new CatalogError('Document not found');
  await ownTrack(db, actor, doc.trackId);

  const { status, error, size } = await validateStoredDocument(store, doc.fileKey, doc.declaredMime);
  await db.update(rightsDocuments).set({ validationStatus: status, validationError: error, sizeBytes: size }).where(eq(rightsDocuments.id, documentId));
  return { status, error };
}

// ---- submit ----

/**
 * Submits a draft for review. Guards (PLAN 4.1): rights declaration complete, at least one valid rights
 * document, an uploaded version whose ingest is ready (ingest runs when the upload is confirmed, so a submitted track can never be stuck on a failed ingest), seller agreement accepted by the org, KYC not rejected.
 * The caller then kicks `processVersion` for the returned version id.
 */
export async function submitTrack(db: DbOrTx, actor: SellerActor, trackId: string): Promise<GuardResult<{ versionId: string }>> {
  const track = await ownTrack(db, actor, trackId);
  const issues: string[] = [];
  if (track.status !== 'draft') return { ok: false, issues: ['Only draft tracks can be submitted'] };

  const [decl] = await db.select().from(rightsDeclarations).where(eq(rightsDeclarations.trackId, trackId));
  if (!decl) issues.push('Complete the rights declaration');
  else {
    const warranted = decl.masterControlled && decl.compositionControlled && decl.coOwnerConsentWarranted && decl.sampleFreeWarranted && decl.notACoverWarranted;
    if (!warranted) issues.push('All rights warranties must be confirmed');
  }
  const [validDoc] = await db
    .select({ id: rightsDocuments.id })
    .from(rightsDocuments)
    .where(and(eq(rightsDocuments.trackId, trackId), eq(rightsDocuments.validationStatus, 'valid')))
    .limit(1);
  if (!validDoc) issues.push('Upload at least one valid rights document');

  const [version] = await db.select().from(trackVersions).where(eq(trackVersions.trackId, trackId)).orderBy(desc(trackVersions.versionNo)).limit(1);
  if (!version) issues.push('Upload the audio file');
  else if (version.ingestStatus === 'failed') issues.push(version.ingestError ?? 'The audio file could not be processed; upload it again');
  else if (version.ingestStatus !== 'ready') issues.push('The audio file is still being processed');

  if (!(await hasOrgAccepted(db, actor.orgId, 'seller_agreement'))) issues.push('Accept the seller agreement');
  const standing = await getSellerStanding(db, actor.orgId);
  if (!standing) issues.push('Complete seller onboarding');
  else if (standing.kycStatus === 'rejected') issues.push('Seller verification was rejected');
  else if (standing.status !== 'active') issues.push('Seller account is not active');

  if (issues.length || !version) return { ok: false, issues };
  const moved = await applyTransition(db, trackId, 'submit', actor.userId);
  if (!moved.ok) return { ok: false, issues: ['The track changed while submitting; refresh and try again'] };
  return { ok: true, value: { versionId: version.id } };
}

/** Seller takes a published or suspended track off sale. Existing licenses are untouched. */
export async function delistOwnTrack(db: DbOrTx, actor: SellerActor, trackId: string) {
  await ownTrack(db, actor, trackId);
  return applyTransition(db, trackId, 'delist', actor.userId, { reason: 'Delisted by seller' });
}
