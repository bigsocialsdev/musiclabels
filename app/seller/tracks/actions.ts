'use server';
import { after } from 'next/server';
import { z } from 'zod';
import {
  CatalogError,
  DOC_TYPES,
  confirmMasterUpload,
  confirmRightsDocument,
  createTrack,
  delistOwnTrack,
  editTrack,
  processVersion,
  requestMasterUpload,
  requestRightsDocumentUpload,
  saveRightsDeclaration,
  submitTrack,
  updateTrack,
  type SellerActor,
} from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { attempt, requireOrg, runForm, text, type SellerCtx } from '../form-action';
import { requireSellerSession } from '../session';
import { REGISTRATION_ROWS } from './form-fields';

const trackPath = (id: string) => `/seller/tracks/${id}`;
const trackIdOf = (f: FormData) => z.uuid().parse(text(f, 'trackId'));
const actorOf = (c: Pick<SellerCtx, 'session' | 'orgId'>): SellerActor => ({ userId: c.session.userId, orgId: requireOrg(c.orgId) });

const list = (f: FormData, k: string) => text(f, k).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
const checked = (f: FormData, k: string) => f.get(k) === 'on';

/** The track form as the catalog's zod schema expects it; the slice does the real validation. */
function trackFields(f: FormData) {
  const bpm = text(f, 'bpm').trim();
  return {
    title: text(f, 'title'),
    primaryArtist: text(f, 'primaryArtist'),
    featuredArtists: list(f, 'featuredArtists'),
    composers: list(f, 'composers'),
    lyricists: list(f, 'lyricists'),
    genreId: text(f, 'genreId') || null,
    moodIds: f.getAll('moodIds').filter((v): v is string => typeof v === 'string'),
    language: text(f, 'language'),
    bpm: bpm ? Number(bpm) : null,
    explicit: checked(f, 'explicit'),
    aiGeneratedDeclared: checked(f, 'aiGeneratedDeclared'),
    organicSocial: checked(f, 'organicSocial'),
    paidAds: checked(f, 'paidAds'),
    editsAllowed: checked(f, 'editsAllowed'),
    proposedPriceLevel: text(f, 'proposedPriceLevel') || null,
  };
}

export async function createTrackAction(formData: FormData) {
  return runForm('/seller/tracks/new', 'Track created. Add the audio and rights documents next.', async (c) => {
    const id = await createTrack(getDb(), actorOf(c), trackFields(formData));
    return trackPath(id);
  });
}

export async function updateTrackAction(formData: FormData) {
  const id = trackIdOf(formData);
  return runForm(trackPath(id), 'Track details saved.', async (c) => {
    await updateTrack(getDb(), actorOf(c), id, trackFields(formData));
  });
}



export async function saveDeclarationAction(formData: FormData) {
  const id = trackIdOf(formData);
  return runForm(trackPath(id), 'Rights declaration saved.', async (c) => {
    const registrations = Array.from({ length: REGISTRATION_ROWS }, (_, i) => ({
      system: text(formData, `reg${i}System`),
      administeredBy: text(formData, `reg${i}By`),
      sellerControlsRelease: checked(formData, `reg${i}Release`),
    })).filter((r) => r.system !== '');
    await saveRightsDeclaration(getDb(), actorOf(c), id, {
      masterControlled: checked(formData, 'masterControlled'),
      compositionControlled: checked(formData, 'compositionControlled'),
      coOwnerConsentWarranted: checked(formData, 'coOwnerConsentWarranted'),
      sampleFreeWarranted: checked(formData, 'sampleFreeWarranted'),
      notACoverWarranted: checked(formData, 'notACoverWarranted'),
      registrations: registrations,
    });
  });
}

/** A rejected track goes back to draft so it can be changed and sent again. */
export async function editTrackAction(formData: FormData) {
  const id = trackIdOf(formData);
  return runForm(trackPath(id), 'You can edit this track now. Submit it again when it is ready.', async (c) => {
    const r = await editTrack(getDb(), actorOf(c), id);
    if (!r.ok) throw new CatalogError('This track can no longer be edited.');
  });
}

export async function submitTrackAction(formData: FormData) {
  const id = trackIdOf(formData);
  return runForm(trackPath(id), 'Submitted for review.', async (c) => {
    const r = await submitTrack(getDb(), actorOf(c), id);
    if (!r.ok) throw new CatalogError(`Not ready yet: ${r.issues.join('; ')}.`);
    after(() => processVersion(r.value.versionId)); // the cron sweep reruns it if this is cut short
  });
}

export async function delistTrackAction(formData: FormData) {
  const id = trackIdOf(formData);
  return runForm(trackPath(id), 'The track is delisted. Licenses already sold are not affected.', async (c) => {
    const r = await delistOwnTrack(getDb(), actorOf(c), id);
    if (!r.ok) throw new CatalogError('This track cannot be delisted from its current status.');
  });
}

// ---- uploads (called from the client UploadForm; the track id is bound by the page) ----

const AUDIO_ID = /^([0-9a-f-]{36})\.(wav|mp3)$/;

/** The upload form's id for an audio file is `<versionId>.<ext>`, so confirm needs nothing else from the browser. */
export async function requestAudioUploadAction(trackId: string, raw: { filename: string }) {
  const { session, orgId } = await requireSellerSession(trackPath(trackId));
  const ext = z.string().max(300).parse(raw.filename).split('.').pop() ?? '';
  return attempt(async () => {
    const r = await requestMasterUpload(getDb(), actorOf({ session, orgId }), z.uuid().parse(trackId), ext);
    return { id: `${r.versionId}.${ext.toLowerCase()}`, key: r.key, token: r.token };
  });
}

export async function confirmAudioUploadAction(trackId: string, uploadId: string) {
  const { session, orgId } = await requireSellerSession(trackPath(trackId));
  const m = AUDIO_ID.exec(z.string().max(60).parse(uploadId));
  if (!m) return { ok: false as const, error: 'Invalid upload.' };
  const r = await attempt(async () => ({ versionId: await confirmMasterUpload(getDb(), actorOf({ session, orgId }), z.uuid().parse(trackId), m[1]!, m[2]!) }));
  if (!r.ok) return r;
  after(() => processVersion(r.versionId));
  return { ok: true as const, message: 'Uploaded. We are processing the audio; this can take a few minutes.' };
}

export async function requestDocumentUploadAction(trackId: string, raw: { choice: string; mime: string }) {
  const { session, orgId } = await requireSellerSession(trackPath(trackId));
  const input = z.object({ choice: z.enum(DOC_TYPES), mime: z.string().max(100) }).parse(raw);
  return attempt(async () => {
    const r = await requestRightsDocumentUpload(getDb(), actorOf({ session, orgId }), z.uuid().parse(trackId), { docType: input.choice, mime: input.mime });
    return { id: r.documentId, key: r.key, token: r.token };
  });
}

export async function confirmDocumentUploadAction(trackId: string, documentId: string) {
  const { session, orgId } = await requireSellerSession(trackPath(trackId));
  const r = await attempt(() => confirmRightsDocument(getDb(), actorOf({ session, orgId }), z.uuid().parse(documentId)));
  if (!r.ok) return r;
  return r.status === 'valid' ? { ok: true as const, message: 'Uploaded and checked.' } : { ok: false as const, error: r.error ?? 'The file was rejected.' };
}
