import { and, asc, desc, eq } from 'drizzle-orm';
import { genres, moods, rightsDeclarations, rightsDocuments, trackEvents, trackVersions, tracks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import type { ClearanceClass, DocType, TrackStatus } from '../index';
import { requireMember, type SellerActor } from './seller';

/** The org's tracks, newest first. Scoped by the caller's org here; storage keys never leave the slice. */
export async function listOwnTracks(db: DbOrTx, actor: SellerActor) {
  await requireMember(db, actor);
  const rows = await db
    .select({ id: tracks.id, title: tracks.title, primaryArtist: tracks.primaryArtist, status: tracks.status, clearanceClass: tracks.clearanceClass, updatedAt: tracks.updatedAt })
    .from(tracks)
    .where(eq(tracks.sellerOrgId, actor.orgId))
    .orderBy(desc(tracks.createdAt));
  return rows.map((r) => ({ ...r, status: r.status as TrackStatus, clearanceClass: r.clearanceClass as ClearanceClass }));
}

/** One of the org's tracks with everything its page shows; null when it is not this org's. */
export async function getOwnTrack(db: DbOrTx, actor: SellerActor, trackId: string) {
  await requireMember(db, actor);
  const [track] = await db.select().from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.sellerOrgId, actor.orgId)));
  if (!track) return null;
  const [declaration] = await db.select().from(rightsDeclarations).where(eq(rightsDeclarations.trackId, trackId));
  const documents = await db
    .select({ id: rightsDocuments.id, docType: rightsDocuments.docType, status: rightsDocuments.validationStatus, error: rightsDocuments.validationError, uploadedAt: rightsDocuments.uploadedAt })
    .from(rightsDocuments)
    .where(eq(rightsDocuments.trackId, trackId))
    .orderBy(asc(rightsDocuments.uploadedAt));
  const versions = await db
    .select({ id: trackVersions.id, versionNo: trackVersions.versionNo, ingestStatus: trackVersions.ingestStatus, ingestError: trackVersions.ingestError, durationMs: trackVersions.durationMs, createdAt: trackVersions.createdAt })
    .from(trackVersions)
    .where(eq(trackVersions.trackId, trackId))
    .orderBy(desc(trackVersions.versionNo));
  const [lastRejection] = await db
    .select({ reason: trackEvents.reason, at: trackEvents.at })
    .from(trackEvents)
    .where(and(eq(trackEvents.trackId, trackId), eq(trackEvents.toStatus, 'rejected')))
    .orderBy(desc(trackEvents.at))
    .limit(1);
  return {
    track: { ...track, status: track.status as TrackStatus, clearanceClass: track.clearanceClass as ClearanceClass },
    declaration: declaration ?? null,
    documents: documents.map((d) => ({ ...d, docType: d.docType as DocType })),
    versions,
    /**
     * Why the latest review rejected it. Kept while the track is back in draft for changes (the seller needs the
     * reason most then); gone once it is resubmitted, and replaced if it is rejected again.
     */
    rejection: track.status === 'rejected' || (track.status === 'draft' && lastRejection) ? { reason: track.rejectionReason ?? lastRejection?.reason ?? null } : null,
  };
}

/** Active genres and moods for the upload form. */
export async function listTaxonomy(db: DbOrTx) {
  const [g, m] = await Promise.all([
    db.select({ id: genres.id, name: genres.name }).from(genres).where(eq(genres.active, true)).orderBy(asc(genres.name)),
    db.select({ id: moods.id, name: moods.name }).from(moods).where(eq(moods.active, true)).orderBy(asc(moods.name)),
  ]);
  return { genres: g, moods: m };
}
