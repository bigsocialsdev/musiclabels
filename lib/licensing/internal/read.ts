import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { licenseDownloads, licensedChannels, licensedVideos, licenses, trackVersions } from '@/db/schema';
import { getMembershipRole } from '@/lib/identity/server';
import type { DbOrTx } from '@/lib/platform/db';
import { BUCKETS, createSignedDownloadUrl } from '@/lib/platform/storage';
import { effectiveStatus, normalizePublicId, type LicenseStatus, type Result } from '../index';
import type { License } from './issue';
import { isRecordIntact } from './record-hash';
import type { BuyerActor } from './usage';

export type ResolvedLicense = License & { effectiveStatus: LicenseStatus; recordIntact: boolean };

const resolve = (row: License, now: Date): ResolvedLicense => ({ ...row, effectiveStatus: effectiveStatus(row, now), recordIntact: isRecordIntact(row) });

/**
 * Resolves a typed or scanned public id. Status is the effective one (a lapsed paid-ad license reads as
 * expired before the sweep stores it); `recordIntact` recomputes the record hash from the stored row.
 */
export async function getLicenseByPublicId(db: DbOrTx, rawPublicId: string, now: Date = new Date()): Promise<ResolvedLicense | null> {
  const publicId = normalizePublicId(rawPublicId);
  if (!publicId) return null;
  const [row] = await db.select().from(licenses).where(eq(licenses.publicId, publicId));
  return row ? resolve(row, now) : null;
}

export async function getLicenseByOrder(db: DbOrTx, orderId: string): Promise<License | null> {
  const [row] = await db.select().from(licenses).where(eq(licenses.orderId, orderId));
  return row ?? null;
}

export async function listActiveChannels(db: DbOrTx, licenseId: string) {
  return db
    .select({ id: licensedChannels.id, platform: licensedChannels.platform, handleOrUrl: licensedChannels.handleOrUrl, verificationStatus: licensedChannels.verificationStatus })
    .from(licensedChannels)
    .where(and(eq(licensedChannels.licenseId, licenseId), isNull(licensedChannels.removedAt)))
    .orderBy(asc(licensedChannels.addedAt));
}

/** The acting org for a user on a license: its purchasing org, if the user is a member of it. */
export async function resolveBuyerActor(db: DbOrTx, userId: string, licenseId: string): Promise<BuyerActor | null> {
  const [l] = await db.select({ orgId: licenses.purchaserOrgId }).from(licenses).where(eq(licenses.id, licenseId));
  if (!l || !(await getMembershipRole(db, userId, l.orgId))) return null;
  return { userId, orgId: l.orgId };
}

/** A license as its purchasing org sees it; another org's license (or a non-member) gets null. */
export async function getLicenseForBuyer(db: DbOrTx, actor: BuyerActor, licenseId: string) {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) return null;
  const [row] = await db
    .select()
    .from(licenses)
    .where(and(eq(licenses.id, licenseId), eq(licenses.purchaserOrgId, actor.orgId)));
  if (!row) return null;
  const [channels, videos, [downloads]] = await Promise.all([
    listActiveChannels(db, row.id),
    db.select().from(licensedVideos).where(eq(licensedVideos.licenseId, row.id)).orderBy(asc(licensedVideos.registeredAt)),
    db.select({ n: count() }).from(licenseDownloads).where(eq(licenseDownloads.licenseId, row.id)),
  ]);
  return { license: resolve(row, new Date()), channels, videos, downloadsUsed: downloads!.n, downloadsCap: MAX_DOWNLOADS };
}

/** PLAN §13.13: 20 clean-file downloads per license, 15-minute signed URLs. */
export const MAX_DOWNLOADS = 20;
const DOWNLOAD_URL_SECONDS = 15 * 60;

type Signer = (bucket: (typeof BUCKETS)['masters'], key: string, seconds: number, name: string) => Promise<string>;

/**
 * Issues one signed URL for the clean master or MP3 of the licensed version, counting it against the cap.
 * Only while the license is in force; revoked (refunded) and expired licenses get no new files.
 */
export async function issueDownloadUrl(
  db: DbOrTx,
  actor: BuyerActor,
  licenseId: string,
  file: 'master' | 'mp3',
  sign: Signer = createSignedDownloadUrl,
): Promise<Result<{ url: string }>> {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) return { ok: false, issues: ['not_found'] };
  const target = await db.transaction(async (tx) => {
    const [l] = await tx
      .select({ status: licenses.status, endsAt: licenses.endsAt, trackVersionId: licenses.trackVersionId, publicId: licenses.publicId, title: licenses.trackTitle })
      .from(licenses)
      .where(and(eq(licenses.id, licenseId), eq(licenses.purchaserOrgId, actor.orgId)))
      .for('update');
    if (!l) return { ok: false, issues: ['not_found'] } as const;
    if (effectiveStatus(l) !== 'active') return { ok: false, issues: ['license_not_active'] } as const;
    const [used] = await tx.select({ n: count() }).from(licenseDownloads).where(eq(licenseDownloads.licenseId, licenseId));
    if (used!.n >= MAX_DOWNLOADS) return { ok: false, issues: ['download_limit_reached'] } as const;
    const [v] = await tx
      .select({ masterKey: trackVersions.masterKey, masterFormat: trackVersions.masterFormat, mp3Key: trackVersions.mp3DerivativeKey })
      .from(trackVersions)
      .where(eq(trackVersions.id, l.trackVersionId));
    const key = file === 'master' ? v!.masterKey : v!.mp3Key;
    if (!key) return { ok: false, issues: ['file_unavailable'] } as const;
    await tx.insert(licenseDownloads).values({ licenseId, userId: actor.userId, file });
    const ext = file === 'mp3' ? 'mp3' : (v!.masterFormat ?? 'wav');
    return { ok: true, key, name: `${l.title} (${l.publicId}).${ext}` } as const;
  });
  if (!target.ok) return { ok: false, issues: [...target.issues] };
  // Clean master and its MP3 derivative both live in the private masters bucket.
  return { ok: true, value: { url: await sign(BUCKETS.masters, target.key, DOWNLOAD_URL_SECONDS, target.name) } };
}
