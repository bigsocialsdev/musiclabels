import { createHash } from 'node:crypto';
import { desc, eq, max } from 'drizzle-orm';
import { certificates } from '@/db/schema';
import { getOrganization } from '@/lib/identity/server';
import { getInvoiceByOrder } from '@/lib/invoicing/server';
import { getLegalDocument } from '@/lib/legal/server';
import {
  getLicenseByPublicId,
  getLicenseForBuyer,
  getTermsVersion,
  listActiveChannels,
  type BuyerActor,
  type License,
  type Tier,
} from '@/lib/licensing/server';
import { enqueueOpsAlert } from '@/lib/notifications/server';
import type { DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { uuidv7 } from '@/lib/platform/ids';
import { consume } from '@/lib/platform/ratelimit';
import { BUCKETS, createSignedDownloadUrl, type ObjectStore } from '@/lib/platform/storage';
import { maskName } from '../index';
import { renderCertificatePdf, renderDisputeKitPdf, type CertificateData } from './pdf';

export const verifyUrl = (publicId: string) => `${getEnv().APP_URL}/verify/${publicId}`;

async function certificateData(db: DbOrTx, l: License, revision: number, issuedAt: Date): Promise<CertificateData> {
  const [channels, terms, org] = await Promise.all([listActiveChannels(db, l.id), getTermsVersion(db, l.termsVersionId), getOrganization(db, l.purchaserOrgId)]);
  return {
    publicId: l.publicId,
    recordHash: l.recordHash,
    verifyUrl: verifyUrl(l.publicId),
    revision,
    trackTitle: l.trackTitle,
    primaryArtist: l.primaryArtist,
    tier: l.tier as Tier,
    licenseeDisplay: l.licenseeName,
    purchaserName: l.clientName ? (org?.legalName ?? null) : null,
    editsAllowed: l.editsAllowed,
    territory: l.territory,
    startsAt: l.startsAt,
    endsAt: l.endsAt,
    licenseTextVersion: terms!.licenseTextVersion,
    videoCap: terms!.videoCap,
    channels,
    issuedAt,
  };
}

/**
 * Renders the next certificate revision from the license and its current channels and stores it. The object
 * key is unique per attempt, so a concurrent or retried render never overwrites a stored revision's file.
 */
export async function issueCertificateRevision(db: DbOrTx, license: License, store: ObjectStore): Promise<number> {
  const [{ latest } = { latest: null }] = await db.select({ latest: max(certificates.revision) }).from(certificates).where(eq(certificates.licenseId, license.id));
  const revision = (latest ?? 0) + 1;
  const pdf = await renderCertificatePdf(await certificateData(db, license, revision, new Date()));
  const key = `certificates/${license.id}/r${revision}-${uuidv7()}.pdf`;
  await store.upload(BUCKETS.pdfs, key, pdf, 'application/pdf');
  await db
    .insert(certificates)
    .values({ licenseId: license.id, revision, pdfKey: key, pdfSha256: createHash('sha256').update(pdf).digest('hex') })
    .onConflictDoNothing();
  return revision;
}

/** Fulfilment step c: revision 1 exactly once. */
export async function ensureFirstCertificate(db: DbOrTx, license: License, store: ObjectStore): Promise<void> {
  const [existing] = await db.select({ id: certificates.id }).from(certificates).where(eq(certificates.licenseId, license.id)).limit(1);
  if (!existing) await issueCertificateRevision(db, license, store);
}

export type VerifyView = {
  publicId: string;
  status: 'active' | 'expired' | 'revoked';
  trackTitle: string;
  primaryArtist: string;
  tier: Tier;
  licensee: string;
  purchaser: string | null;
  territory: string;
  startsAt: Date;
  endsAt: Date | null;
  issuedAt: Date;
  licenseTextVersion: number;
  channels: { platform: string; handleOrUrl: string; verificationStatus: string }[];
  recordHash: string;
  recordIntact: boolean;
};

/**
 * The public verify page (PLAN §7), read live from the database. Individual licensees are masked. A record
 * whose stored fields no longer match its hash still renders (flagged) and raises an ops alert, at most daily.
 */
export async function getVerifyView(db: DbOrTx, rawPublicId: string): Promise<VerifyView | null> {
  const l = await getLicenseByPublicId(db, rawPublicId);
  if (!l) return null;
  const [channels, terms, org] = await Promise.all([listActiveChannels(db, l.id), getTermsVersion(db, l.termsVersionId), getOrganization(db, l.purchaserOrgId)]);
  if (!l.recordIntact && (await consume(`alert:record_hash:${l.id}`, { capacity: 1, refillPerSecond: 1 / 86_400 }, db))) {
    await enqueueOpsAlert(db, 'record_hash_mismatch', 'License record hash mismatch', { licenseId: l.id, publicId: l.publicId });
  }
  const individual = !l.clientName && org?.buyerType === 'individual';
  return {
    publicId: l.publicId,
    status: l.effectiveStatus,
    trackTitle: l.trackTitle,
    primaryArtist: l.primaryArtist,
    tier: l.tier as Tier,
    licensee: individual ? maskName(l.licenseeName) : l.licenseeName,
    purchaser: l.clientName ? (org?.legalName ?? null) : null,
    territory: l.territory,
    startsAt: l.startsAt,
    endsAt: l.endsAt,
    issuedAt: l.createdAt,
    licenseTextVersion: terms!.licenseTextVersion,
    channels: channels.map(({ platform, handleOrUrl, verificationStatus }) => ({ platform, handleOrUrl, verificationStatus })),
    recordHash: l.recordHash,
    recordIntact: l.recordIntact,
  };
}

type Sign = typeof createSignedDownloadUrl;

/** Signed 15-minute URL for the buyer's latest certificate or the invoice; null when not theirs or not rendered yet. */
export async function buyerDocumentUrl(db: DbOrTx, actor: BuyerActor, licenseId: string, doc: 'certificate' | 'invoice', sign: Sign = createSignedDownloadUrl) {
  const owned = await getLicenseForBuyer(db, actor, licenseId);
  if (!owned) return null;
  const l = owned.license;
  if (doc === 'invoice') {
    const inv = await getInvoiceByOrder(db, l.orderId);
    return inv?.pdfKey ? sign(BUCKETS.pdfs, inv.pdfKey, 900, `${inv.number.replaceAll('/', '-')}.pdf`) : null;
  }
  const [cert] = await db.select().from(certificates).where(eq(certificates.licenseId, l.id)).orderBy(desc(certificates.revision)).limit(1);
  return cert ? sign(BUCKETS.pdfs, cert.pdfKey, 900, `${l.publicId}-r${cert.revision}.pdf`) : null;
}

/** Dispute kit (PLAN §7), rendered on request for the purchasing org: certificate summary, wording, full license text. */
export async function renderDisputeKitForBuyer(db: DbOrTx, actor: BuyerActor, licenseId: string): Promise<{ pdf: Buffer; filename: string } | null> {
  const owned = await getLicenseForBuyer(db, actor, licenseId);
  if (!owned) return null;
  const l = owned.license;
  const text = await getLegalDocument(db, l.licenseTextDocumentId);
  const pdf = await renderDisputeKitPdf(await certificateData(db, l, 0, new Date()), text!.bodyMarkdown);
  return { pdf, filename: `dispute-kit-${l.publicId}.pdf` };
}
