import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { licensedChannels, licenseEvents, licenses, trackVersions, tracks } from '@/db/schema';
import type { DbOrTx } from '@/lib/platform/db';
import { TIERS, channelInputSchema } from '../index';
import { HASH_SCHEMA, computeRecordHash, newPublicId, recordHashInput } from './record-hash';
import { getTermsVersion } from './terms';

export type License = typeof licenses.$inferSelect;

/** Thrown for inputs fulfilment should never produce (a bug or tampered snapshot), so the transaction rolls back. */
export class LicensingError extends Error {}

const issueInputSchema = z.object({
  orderId: z.uuid(),
  trackId: z.uuid(),
  trackVersionId: z.uuid(),
  tier: z.enum(TIERS),
  termsVersionId: z.uuid(),
  licenseeName: z.string().trim().min(1).max(300),
  clientName: z.string().trim().min(1).max(300).nullable().default(null),
  purchaserOrgId: z.uuid(),
  editsAllowed: z.boolean(),
  startsAt: z.date(),
  invoiceNumber: z.string().trim().min(1).max(16),
  renewsLicenseId: z.uuid().nullable().default(null),
  channels: z.array(channelInputSchema).min(1),
});
export type IssueInput = z.input<typeof issueInputSchema>;

/** Calendar months in UTC; a day past the target month's end clamps to its last day (Jan 31 + 1 → Feb 28/29). */
export function addMonthsUtc(d: Date, months: number): Date {
  const target = new Date(d.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

/**
 * Issues the license for one paid order, from the order's snapshot. Call it inside fulfilment's legal-facts
 * transaction (PLAN §5.2 b). Idempotent on order_id: a re-run returns the existing license with
 * `created: false` and writes nothing. The record hash is computed here, once, from the stored values.
 */
export async function issueLicense(db: DbOrTx, raw: IssueInput): Promise<{ license: License; created: boolean }> {
  const input = issueInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(licenses).where(eq(licenses.orderId, input.orderId));
    if (existing) return { license: existing, created: false };

    const terms = await getTermsVersion(tx, input.termsVersionId);
    if (!terms || terms.tier !== input.tier) throw new LicensingError('terms version does not match the tier');

    const [version] = await tx
      .select({ trackId: trackVersions.trackId, masterSha256: trackVersions.masterSha256, ingestStatus: trackVersions.ingestStatus })
      .from(trackVersions)
      .where(eq(trackVersions.id, input.trackVersionId));
    if (!version || version.trackId !== input.trackId || version.ingestStatus !== 'ready' || !version.masterSha256) {
      throw new LicensingError('track version is not a ready version of the track');
    }
    const [track] = await tx
      .select({ title: tracks.title, primaryArtist: tracks.primaryArtist })
      .from(tracks)
      .where(eq(tracks.id, input.trackId));

    const channels = input.channels;
    if (channels.length > terms.maxChannels) throw new LicensingError(`at most ${terms.maxChannels} channels`);
    if (channels.some((c) => !terms.allowedPlatforms.includes(c.platform))) throw new LicensingError('platform not allowed by the terms');
    const keys = channels.map((c) => `${c.platform}/${c.handleOrUrl.toLowerCase()}`);
    if (new Set(keys).size !== keys.length) throw new LicensingError('duplicate channel');

    if (input.renewsLicenseId) {
      const [prev] = await tx
        .select({ purchaserOrgId: licenses.purchaserOrgId, trackId: licenses.trackId, tier: licenses.tier })
        .from(licenses)
        .where(eq(licenses.id, input.renewsLicenseId));
      if (!prev || prev.purchaserOrgId !== input.purchaserOrgId || prev.trackId !== input.trackId || prev.tier !== 'paid_ad' || input.tier !== 'paid_ad') {
        throw new LicensingError('renewal must be a paid_ad license of the same track and purchaser');
      }
    }

    const startsAt = new Date(input.startsAt.getTime());
    const fields = {
      publicId: newPublicId(),
      trackVersionId: input.trackVersionId,
      masterSha256: version.masterSha256,
      trackTitle: track!.title,
      primaryArtist: track!.primaryArtist,
      tier: input.tier,
      termsVersionId: terms.id,
      licenseTextSha256: terms.licenseTextSha256,
      licenseeName: input.licenseeName,
      clientName: input.clientName,
      purchaserOrgId: input.purchaserOrgId,
      territory: 'worldwide',
      editsAllowed: input.editsAllowed,
      startsAt,
      endsAt: terms.termKind === 'fixed_months' ? addMonthsUtc(startsAt, terms.termMonths!) : null,
      invoiceNumber: input.invoiceNumber,
    };

    const [inserted] = await tx
      .insert(licenses)
      .values({
        ...fields,
        orderId: input.orderId,
        trackId: input.trackId,
        licenseTextDocumentId: terms.licenseTextDocumentId,
        hashSchema: HASH_SCHEMA,
        recordHash: computeRecordHash(recordHashInput(fields)),
        renewsLicenseId: input.renewsLicenseId,
      })
      .onConflictDoNothing({ target: licenses.orderId })
      .returning();
    if (!inserted) {
      // A concurrent fulfilment of the same order committed first.
      const [winner] = await tx.select().from(licenses).where(eq(licenses.orderId, input.orderId));
      return { license: winner!, created: false };
    }

    await tx.insert(licensedChannels).values(channels.map((c) => ({ licenseId: inserted.id, platform: c.platform, handleOrUrl: c.handleOrUrl })));
    await tx.insert(licenseEvents).values({ licenseId: inserted.id, fromStatus: 'none', toStatus: 'active', event: 'issue', actorUserId: null });
    return { license: inserted, created: true };
  });
}
