import { getTrackFacts } from '@/lib/catalog/server';
import { enqueueEmail } from '@/lib/notifications/server';
import { getChannelById, getLicenseById, listVideos, type Platform } from '@/lib/licensing/server';
import type { DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { getSellerStanding } from '@/lib/sellers/server';
import type { ClearanceRow } from './requests';
import { issueResponseToken } from './token';

export type ClearanceContext = { tx: DbOrTx; dueAt: Date };

/**
 * The "whitelisting" seam (PLAN §11). A future Content ID intermediary or direct API provider implements this and
 * is routed by config; the workflow, tables and admin queue do not change. `submit` runs inside the dispatcher's
 * transaction (`ctx.tx`), so what it writes commits with the pending → sent move. The interface's optional `poll`
 * is not declared: no provider needs it yet.
 */
export interface ClearanceProvider {
  readonly id: 'manual_seller';
  supports(req: { platform?: Platform; scope: 'channel' | 'video'; clearanceClass: 'A' | 'B' }): boolean;
  submit(req: ClearanceRow, ctx: ClearanceContext): Promise<{ status: 'sent' | 'not_required'; externalRef?: string }>;
}

const formatDate = (d: Date) => d.toISOString().slice(0, 10);

/** Plain-words description of what a request covers ("the youtube channel @x", "the video ..."). */
export async function describeTarget(tx: DbOrTx, req: ClearanceRow): Promise<string> {
  if (req.scope === 'channel') {
    const channel = req.licensedChannelId ? await getChannelById(tx, req.licensedChannelId) : null;
    if (!channel) throw new Error('channel is no longer on the license');
    return `the ${channel.platform} channel ${channel.handleOrUrl}`;
  }
  const video = (await listVideos(tx, req.licenseId)).find((v) => v.id === req.licensedVideoId);
  if (!video) throw new Error('video not found');
  return `the video “${video.label}” (${video.urls.join(', ')})`;
}

/**
 * Emails the seller's ops contact a fresh single-use response link (the first request, an overdue reminder, an
 * admin resend). Issuing the link replaces any earlier one, so at most one is live.
 */
export async function emailSeller(tx: DbOrTx, req: ClearanceRow, opts: { dueNote: string; reminder?: boolean }): Promise<void> {
  const standing = await getSellerStanding(tx, req.sellerOrgId);
  if (!standing?.opsContactEmail) throw new Error('seller has no ops contact email');
  const license = await getLicenseById(tx, req.licenseId);
  if (!license) throw new Error('license not found');
  const track = await getTrackFacts(tx, license.trackId);
  const what = await describeTarget(tx, req);
  const { token, expiresAt } = await issueResponseToken(tx, req.id);
  await enqueueEmail(tx, {
    kind: opts.reminder ? 'clearance.reminder' : 'clearance.request',
    to: standing.opsContactEmail,
    template: 'clearance_request',
    payload: {
      reminder: !!opts.reminder,
      trackTitle: track?.title ?? license.trackTitle,
      licenseeName: license.licenseeName,
      what,
      respondUrl: `${getEnv().APP_URL}/api/clearance/respond/${token}`,
      dueNote: opts.dueNote,
      expiresNote: formatDate(expiresAt),
    },
  });
}

/** The seller releases the use themselves and answers through a single-use link in an email to their ops contact. */
export const manualSellerProvider: ClearanceProvider = {
  id: 'manual_seller',
  supports: (req) => req.clearanceClass === 'B',
  async submit(req, { tx, dueAt }) {
    await emailSeller(tx, req, { dueNote: formatDate(dueAt) });
    return { status: 'sent' };
  },
};

const PROVIDERS: readonly ClearanceProvider[] = [manualSellerProvider];

/** Provider chosen by config for a new request. Today there is one. */
export function providerFor(clearanceClass: 'A' | 'B', scope: 'channel' | 'video' = 'channel'): ClearanceProvider {
  // Class A needs no provider; the row is `not_required`. It still records the default provider id.
  return PROVIDERS.find((p) => p.supports({ scope, clearanceClass })) ?? manualSellerProvider;
}

export function providerById(id: string): ClearanceProvider {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown clearance provider ${id}`);
  return p;
}
