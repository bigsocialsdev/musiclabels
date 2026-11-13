import { eq } from 'drizzle-orm';
import { trackVersions, tracks } from '@/db/schema';
import { isSellable, type PriceLevel, type TrackStatus } from '@/lib/catalog';
import type { DbOrTx } from '@/lib/platform/db';
import { getActivePrice } from '@/lib/pricing/server';
import { getSellerStanding } from '@/lib/sellers/server';
import type { Result, Tier } from '../index';
import { getCurrentTerms } from './terms';

/** Everything an order snapshots at creation (S3-M4). Later code reads the snapshot, not current rules. */
export type LicenseQuote = {
  trackId: string;
  trackVersionId: string;
  trackTitle: string;
  primaryArtist: string;
  sellerOrgId: string;
  tier: Tier;
  priceLevel: PriceLevel;
  priceBookId: string;
  amountPaise: number; // taxable value, GST-exclusive
  termsVersionId: string;
  licenseTextDocumentId: string;
  licenseTextVersion: number;
  editsAllowed: boolean;
};

/** A version buyers can be licensed: belongs to the track, ingested, with a master hash to pin. */
export function isReadyVersionOf(
  v: { trackId: string; ingestStatus: string; masterSha256: string | null } | undefined,
  trackId: string,
): v is { trackId: string; ingestStatus: 'ready'; masterSha256: string } {
  return !!v && v.trackId === trackId && v.ingestStatus === 'ready' && !!v.masterSha256;
}

const tierFlag ={ creator: 'organicSocial', brand_organic: 'organicSocial', paid_ad: 'paidAds' } as const;

/**
 * Can this tier of this track be sold now, and on what terms (PLAN §6.1)? Returns every blocking issue.
 * Only published tracks of active sellers, classed A or B, with the tier's usage flag, a ready current
 * version, a price in the active book and terms in force are sellable.
 */
async function standingIssues(db: DbOrTx, track: { status: string; clearanceClass: string; sellerOrgId: string }): Promise<string[]> {
  const issues: string[] = [];
  if (!isSellable(track.status as TrackStatus)) issues.push('track_not_published');
  if (track.clearanceClass !== 'A' && track.clearanceClass !== 'B') issues.push('clearance_class_not_sellable');
  const standing = await getSellerStanding(db, track.sellerOrgId);
  if (standing?.status !== 'active') issues.push('seller_not_active');
  return issues;
}

/** Re-check at fulfilment (PLAN §5.2 a): is the track still sellable at all? Price and terms come from the order. */
export async function sellabilityIssues(db: DbOrTx, trackId: string): Promise<string[]> {
  const [track] = await db
    .select({ status: tracks.status, clearanceClass: tracks.clearanceClass, sellerOrgId: tracks.sellerOrgId })
    .from(tracks)
    .where(eq(tracks.id, trackId));
  return track ? standingIssues(db, track) : ['track_not_found'];
}

export async function quoteLicense(db: DbOrTx, trackId: string, tier: Tier, at: Date = new Date()): Promise<Result<LicenseQuote>> {
  const [track] = await db.select().from(tracks).where(eq(tracks.id, trackId));
  if (!track) return { ok: false, issues: ['track_not_found'] };

  const issues = await standingIssues(db, track);
  if (!track[tierFlag[tier]]) issues.push('tier_not_offered');

  const [version] = track.currentVersionId
    ? await db.select().from(trackVersions).where(eq(trackVersions.id, track.currentVersionId))
    : [];
  if (!isReadyVersionOf(version, track.id)) issues.push('no_ready_version');

  const price = track.priceLevel ? await getActivePrice(db, track.priceLevel as PriceLevel, tier) : null;
  if (!price) issues.push('no_price');
  const terms = await getCurrentTerms(db, tier, at);
  if (!terms) issues.push('no_terms');

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      trackId: track.id,
      trackVersionId: version!.id,
      trackTitle: track.title,
      primaryArtist: track.primaryArtist,
      sellerOrgId: track.sellerOrgId,
      tier,
      priceLevel: track.priceLevel as PriceLevel,
      priceBookId: price!.priceBookId,
      amountPaise: price!.amountPaise,
      termsVersionId: terms!.id,
      licenseTextDocumentId: terms!.licenseTextDocumentId,
      licenseTextVersion: terms!.licenseTextVersion,
      editsAllowed: track.editsAllowed,
    },
  };
}
