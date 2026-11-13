import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull } from 'drizzle-orm';
import { licenseDownloads, licensedChannels, licensedVideos, licenses, memberships, trackVersions } from '@/db/schema';
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

export async function getLicenseById(db: DbOrTx, licenseId: string): Promise<ResolvedLicense | null> {
  const [row] = await db.select().from(licenses).where(eq(licenses.id, licenseId));
  return row ? resolve(row, new Date()) : null;
}

/** Registered creatives of a license, oldest first. */
export async function listVideos(db: DbOrTx, licenseId: string) {
  return db.select().from(licensedVideos).where(eq(licensedVideos.licenseId, licenseId)).orderBy(asc(licensedVideos.registeredAt));
}

export type ChannelRef = { id: string; licenseId: string; platform: string; handleOrUrl: string; verificationStatus: string };

/** An active channel of a license, as its purchasing org sees it; another org's channel (or a non-member) gets null. */
export async function getChannelForBuyer(db: DbOrTx, actor: BuyerActor, channelId: string): Promise<ChannelRef | null> {
  if (!(await getMembershipRole(db, actor.userId, actor.orgId))) return null;
  const [row] = await db
    .select({ id: licensedChannels.id, licenseId: licensedChannels.licenseId, platform: licensedChannels.platform, handleOrUrl: licensedChannels.handleOrUrl, verificationStatus: licensedChannels.verificationStatus })
    .from(licensedChannels)
    .innerJoin(licenses, eq(licenses.id, licensedChannels.licenseId))
    .where(and(eq(licensedChannels.id, channelId), isNull(licensedChannels.removedAt), eq(licenses.purchaserOrgId, actor.orgId)));
  return row ?? null;
}

/** Admin read for hand verification (Instagram/Facebook). */
export async function getChannelById(db: DbOrTx, channelId: string): Promise<ChannelRef | null> {
  const [row] = await db
    .select({ id: licensedChannels.id, licenseId: licensedChannels.licenseId, platform: licensedChannels.platform, handleOrUrl: licensedChannels.handleOrUrl, verificationStatus: licensedChannels.verificationStatus })
    .from(licensedChannels)
    .where(and(eq(licensedChannels.id, channelId), isNull(licensedChannels.removedAt)));
  return row ?? null;
}

/** Channel verification status is owned here; the clearance slice's verifier calls this. */
export async function setChannelVerification(db: DbOrTx, channelId: string, status: 'unverified' | 'pending' | 'verified'): Promise<void> {
  await db.update(licensedChannels).set({ verificationStatus: status }).where(eq(licensedChannels.id, channelId));
}

/** Active licenses of a track: what an upheld copyright complaint puts under review (PLAN §5.5). */
export async function listActiveLicensesForTrack(db: DbOrTx, trackId: string) {
  return db
    .select({ id: licenses.id, publicId: licenses.publicId, orderId: licenses.orderId })
    .from(licenses)
    .where(and(eq(licenses.trackId, trackId), eq(licenses.status, 'active')))
    .orderBy(asc(licenses.createdAt));
}

export const LICENSE_LIST_PAGE_SIZE = 25;

export type BuyerLicenseRow = {
  id: string;
  publicId: string;
  trackTitle: string;
  primaryArtist: string;
  tier: string;
  licenseeName: string;
  clientName: string | null;
  startsAt: Date;
  endsAt: Date | null;
  status: LicenseStatus;
};

/**
 * Every license bought by any org the user belongs to, newest first. `client` filters by client name (agencies buy for
 * clients, PLAN §6.4); `clients` lists the names to filter by. Scoped by membership in the query itself, so another org's
 * license can never appear whatever the caller passes.
 */
export async function listBuyerLicenses(db: DbOrTx, userId: string, opts: { client?: string; page?: number; pageSize?: number } = {}, now: Date = new Date()) {
  const mine = db.select({ orgId: memberships.orgId }).from(memberships).where(eq(memberships.userId, userId));
  const scope = inArray(licenses.purchaserOrgId, mine);
  const client = opts.client?.trim().slice(0, 100);
  // Escape LIKE wildcards: the filter is a substring match on what the buyer typed, not a pattern.
  const where = client ? and(scope, ilike(licenses.clientName, `%${client.replace(/[\\%_]/g, '\\$&')}%`)) : scope;
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const size = opts.pageSize ?? LICENSE_LIST_PAGE_SIZE;
  const [rows, [total], clientRows] = await Promise.all([
    db
      .select()
      .from(licenses)
      .where(where)
      .orderBy(desc(licenses.createdAt), desc(licenses.id))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ n: count() }).from(licenses).where(where),
    db.selectDistinct({ name: licenses.clientName }).from(licenses).where(and(scope, isNotNull(licenses.clientName))).orderBy(asc(licenses.clientName)).limit(100),
  ]);
  return {
    licenses: rows.map(
      (r): BuyerLicenseRow => ({ id: r.id, publicId: r.publicId, trackTitle: r.trackTitle, primaryArtist: r.primaryArtist, tier: r.tier, licenseeName: r.licenseeName, clientName: r.clientName, startsAt: r.startsAt, endsAt: r.endsAt, status: effectiveStatus(r, now) }),
    ),
    total: total!.n,
    pages: Math.max(1, Math.ceil(total!.n / size)),
    page,
    clients: clientRows.flatMap((c) => (c.name ? [c.name] : [])),
  };
}
