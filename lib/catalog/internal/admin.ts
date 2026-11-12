import { asc, desc, eq, sql } from 'drizzle-orm';
import { rightsDeclarations, rightsDocuments, trackVersions, tracks } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import type { AdminContext } from '@/lib/identity';
import { hasOrgAccepted } from '@/lib/legal/server';
import type { DbOrTx } from '@/lib/platform/db';
import { BUCKETS, createSignedDownloadUrl } from '@/lib/platform/storage';
import { getReviewFacts } from '@/lib/screening/server';
import { getSellerStanding } from '@/lib/sellers/server';
import { PRICE_LEVELS, type GuardResult, type PriceLevel, type TrackEvent } from '../index';
import { CatalogError } from './seller';
import { applyTransition } from './transition';

function requireVerification(admin: AdminContext) {
  if (!admin.permissions.includes('verification') && !admin.permissions.includes('superadmin')) {
    throw new CatalogError('This action requires the verification permission');
  }
}

export type ApproveInput = {
  trackId: string;
  clearanceClass: 'A' | 'B';
  priceLevel: PriceLevel;
  /** Required when screening found a match or was unavailable: why the admin is publishing anyway. */
  overrideNote?: string | null;
};

/**
 * Publishes a track in review. All guards must hold (PLAN 4.1/4.3): latest version ingested, a finished screening
 * (a match or an unavailable vendor needs an override note; an errored screening blocks), at least one claim probe
 * on that version, class A or B (B needs the seller's accepted release commitment and an ops contact), a price
 * level, and a seller in good standing. Writes the audit row citing the screening and probes in the same transaction.
 */
export async function approveTrack(db: DbOrTx, admin: AdminContext, input: ApproveInput, ip?: string | null): Promise<GuardResult<{ versionId: string }>> {
  requireVerification(admin);
  return db.transaction(async (tx) => {
    const [track] = await tx.select().from(tracks).where(eq(tracks.id, input.trackId));
    if (!track) throw new CatalogError('Track not found');
    const issues: string[] = [];
    if (track.status !== 'in_review') return { ok: false as const, issues: ['Only tracks in review can be approved'] };

    const [version] = await tx.select().from(trackVersions).where(eq(trackVersions.trackId, track.id)).orderBy(desc(trackVersions.versionNo)).limit(1);
    if (!version || version.ingestStatus !== 'ready') return { ok: false as const, issues: ['The latest audio version is not ready'] };

    const facts = await getReviewFacts(tx, version.id);
    const note = input.overrideNote?.trim() ?? '';
    const s = facts.screening;
    if (!s || s.status === 'queued' || s.status === 'error') issues.push('Screening has not finished');
    else if ((s.status === 'match' || s.status === 'unavailable') && note.length < 10) {
      issues.push(
        s.status === 'match' ? 'Screening found a match: an override note (at least 10 characters) is required' : 'Screening was unavailable: an override note (at least 10 characters) is required',
      );
    }
    if (facts.probes.length === 0) issues.push('Record a claim probe for this version');
    if (!PRICE_LEVELS.includes(input.priceLevel)) issues.push('Choose a price level');
    if (input.clearanceClass !== 'A' && input.clearanceClass !== 'B') issues.push('Assign class A or B (use reject for class C)');

    const standing = await getSellerStanding(tx, track.sellerOrgId);
    if (!standing || standing.status !== 'active') issues.push('Seller account is not active');
    else if (!standing.worldwideRightsWarranted) issues.push('Seller has not warranted worldwide rights');
    if (input.clearanceClass === 'B') {
      if (!(await hasOrgAccepted(tx, track.sellerOrgId, 'release_commitment'))) issues.push('Class B needs the seller’s accepted release commitment');
      if (!standing?.opsContactEmail) issues.push('Class B needs a seller ops contact');
    }
    if (issues.length) return { ok: false as const, issues };

    const moved = await applyTransition(tx, track.id, 'approve', admin.userId, {
      set: { priceLevel: input.priceLevel, clearanceClass: input.clearanceClass, currentVersionId: version.id, publishedAt: new Date(), rejectionReason: null },
    });
    if (!moved.ok) return { ok: false as const, issues: ['The track changed while approving; refresh and try again'] };
    await writeAudit(tx, {
      actorUserId: admin.userId,
      action: 'track.approve',
      entityType: 'track',
      entityId: track.id,
      before: { status: 'in_review', clearanceClass: track.clearanceClass },
      after: {
        status: 'published',
        clearanceClass: input.clearanceClass,
        priceLevel: input.priceLevel,
        versionId: version.id,
        screeningId: s?.id,
        screeningStatus: s?.status,
        probeIds: facts.probes.map((p) => p.id),
        overrideNote: note || null,
      },
      ip,
    });
    return { ok: true as const, value: { versionId: version.id } };
  });
}

/** Rejects a track in review with a seller-visible reason; `classC` records clearance class C (cannot be cleared). */
export async function rejectTrack(db: DbOrTx, admin: AdminContext, input: { trackId: string; reason: string; classC?: boolean }, ip?: string | null) {
  requireVerification(admin);
  const reason = input.reason.trim();
  if (!reason) throw new CatalogError('A rejection reason is required');
  return db.transaction(async (tx) => {
    const event: TrackEvent = input.classC ? 'classify_c' : 'reject';
    const result = await applyTransition(tx, input.trackId, event, admin.userId, {
      reason,
      set: { rejectionReason: reason, ...(input.classC ? { clearanceClass: 'C' as const } : {}) },
    });
    if (result.ok) {
      await writeAudit(tx, { actorUserId: admin.userId, action: `track.${event}`, entityType: 'track', entityId: input.trackId, before: { status: result.from }, after: { status: result.to, reason }, ip });
    }
    return result;
  });
}

/** suspend / reinstate / delist by an admin. Existing licenses are never touched. */
export async function setTrackAvailability(
  db: DbOrTx,
  admin: AdminContext,
  input: { trackId: string; action: 'suspend' | 'reinstate' | 'delist'; reason: string },
  ip?: string | null,
) {
  requireVerification(admin);
  const reason = input.reason.trim();
  if (!reason) throw new CatalogError('A reason is required');
  return db.transaction(async (tx) => {
    const result = await applyTransition(tx, input.trackId, input.action, admin.userId, { reason });
    if (result.ok) {
      await writeAudit(tx, { actorUserId: admin.userId, action: `track.${input.action}`, entityType: 'track', entityId: input.trackId, before: { status: result.from }, after: { status: result.to, reason }, ip });
    }
    return result;
  });
}

export type ReviewQueueRow = {
  trackId: string;
  title: string;
  primaryArtist: string;
  sellerName: string;
  screeningStatus: string | null;
  probeCount: number;
  submittedAt: Date;
};

/** In-review tracks, oldest first (ageing). */
export async function listReviewQueue(db: DbOrTx): Promise<ReviewQueueRow[]> {
  const rows = await db.execute<{ track_id: string; title: string; artist: string; seller: string; screening: string | null; probes: number; at: Date }>(sql`
    SELECT t.id AS track_id, t.title, t.primary_artist AS artist, o.display_name AS seller,
           s.status AS screening,
           (SELECT count(*)::int FROM claim_probes p WHERE p.track_version_id = v.id) AS probes,
           t.updated_at AS at
    FROM tracks t
    JOIN organizations o ON o.id = t.seller_org_id
    JOIN LATERAL (SELECT id FROM track_versions WHERE track_id = t.id ORDER BY version_no DESC LIMIT 1) v ON true
    LEFT JOIN screenings s ON s.track_version_id = v.id
    WHERE t.status = 'in_review'
    ORDER BY t.updated_at ASC`);
  return rows.map((r) => ({ trackId: r.track_id, title: r.title, primaryArtist: r.artist, sellerName: r.seller, screeningStatus: r.screening, probeCount: r.probes, submittedAt: new Date(r.at) }));
}

/** Everything the review page shows for one track. */
export async function getReviewDetail(db: DbOrTx, trackId: string) {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) return null;
  const [version] = await db.select().from(trackVersions).where(eq(trackVersions.trackId, trackId)).orderBy(desc(trackVersions.versionNo)).limit(1);
  const facts = version ? await getReviewFacts(db, version.id) : null;
  const [declaration] = await db.select().from(rightsDeclarations).where(eq(rightsDeclarations.trackId, trackId));
  const documents = await db.select().from(rightsDocuments).where(eq(rightsDocuments.trackId, trackId)).orderBy(asc(rightsDocuments.uploadedAt));
  return { track, version: version ?? null, facts, declaration: declaration ?? null, documents };
}

/** Admin download of a rights document: short-lived signed URL that forces an attachment download (PLAN F9), audited. */
export async function rightsDocumentDownloadUrl(db: DbOrTx, admin: AdminContext, documentId: string, ip?: string | null): Promise<string> {
  requireVerification(admin);
  const [doc] = await db.select().from(rightsDocuments).where(eq(rightsDocuments.id, documentId));
  if (!doc || doc.validationStatus !== 'valid') throw new CatalogError('Document not found');
  await writeAudit(db, { actorUserId: admin.userId, action: 'rights_document.download', entityType: 'rights_document', entityId: doc.id, after: { trackId: doc.trackId }, ip });
  return createSignedDownloadUrl(BUCKETS.documents, doc.fileKey, 900, `rights-document-${doc.id}.${doc.fileKey.split('.').pop()}`);
}
