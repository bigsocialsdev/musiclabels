import { and, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { licensedChannels, licensedVideos, licenses } from '@/db/schema';
import { getMembershipRole } from '@/lib/identity/server';
import type { DbOrTx, Tx } from '@/lib/platform/db';
import {
  MAX_CHANNEL_CORRECTIONS,
  channelInputSchema,
  effectiveStatus,
  videoInputSchema,
  videoUrlSchema,
  type ChannelInput,
  type Result,
  type VideoInput,
} from '../index';
import { getTermsVersion, type TermsVersion } from './terms';

/** A buyer acting for an org. orgId comes from the client, so membership is checked here. */
export type BuyerActor = { userId: string; orgId: string };

type Locked = { licenseId: string; terms: TermsVersion };

/**
 * Locks the license row (serialising cap checks per license) after checking the actor belongs to the
 * purchasing org. Another org's license and a missing one look the same: not_found.
 * Caps come from the terms version pinned on the license, never the current one.
 */
async function lockForUsage(tx: Tx, actor: BuyerActor, licenseId: string): Promise<Result<Locked>> {
  if (!(await getMembershipRole(tx, actor.userId, actor.orgId))) return { ok: false, issues: ['not_found'] };
  const [l] = await tx
    .select({ status: licenses.status, endsAt: licenses.endsAt, termsVersionId: licenses.termsVersionId })
    .from(licenses)
    .where(and(eq(licenses.id, licenseId), eq(licenses.purchaserOrgId, actor.orgId)))
    .for('update');
  if (!l) return { ok: false, issues: ['not_found'] };
  if (effectiveStatus(l) !== 'active') return { ok: false, issues: ['license_not_active'] };
  return { ok: true, value: { licenseId, terms: (await getTermsVersion(tx, l.termsVersionId))! } };
}

async function activeChannels(tx: Tx, licenseId: string) {
  return tx
    .select({ id: licensedChannels.id, platform: licensedChannels.platform, handleOrUrl: licensedChannels.handleOrUrl })
    .from(licensedChannels)
    .where(and(eq(licensedChannels.licenseId, licenseId), isNull(licensedChannels.removedAt)));
}

function channelIssues(terms: TermsVersion, existing: { platform: string; handleOrUrl: string }[], c: { platform: string; handleOrUrl: string }) {
  const issues: string[] = [];
  if (!(terms.allowedPlatforms as string[]).includes(c.platform)) issues.push('platform_not_allowed');
  if (existing.some((e) => e.platform === c.platform && e.handleOrUrl.toLowerCase() === c.handleOrUrl.toLowerCase())) issues.push('duplicate_channel');
  return issues;
}

/** Adds a channel while the license is active and under its pinned max_channels. */
export async function addChannel(db: DbOrTx, actor: BuyerActor, licenseId: string, raw: ChannelInput): Promise<Result<{ channelId: string }>> {
  const c = channelInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const locked = await lockForUsage(tx, actor, licenseId);
    if (!locked.ok) return locked;
    const existing = await activeChannels(tx, licenseId);
    const issues = channelIssues(locked.value.terms, existing, c);
    if (existing.length >= locked.value.terms.maxChannels) issues.push('channel_cap_reached');
    if (issues.length) return { ok: false, issues };
    const [row] = await tx.insert(licensedChannels).values({ licenseId, platform: c.platform, handleOrUrl: c.handleOrUrl }).returning({ id: licensedChannels.id });
    return { ok: true, value: { channelId: row!.id } };
  });
}

/**
 * Replaces a channel (a correction): only before any video is registered and at most
 * MAX_CHANNEL_CORRECTIONS times per license. The old row is kept with removed_at set.
 */
export async function replaceChannel(
  db: DbOrTx,
  actor: BuyerActor,
  licenseId: string,
  channelId: string,
  raw: ChannelInput,
): Promise<Result<{ channelId: string }>> {
  const c = channelInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const locked = await lockForUsage(tx, actor, licenseId);
    if (!locked.ok) return locked;
    const existing = await activeChannels(tx, licenseId);
    if (!existing.some((e) => e.id === channelId)) return { ok: false, issues: ['channel_not_found'] };

    const issues = channelIssues(locked.value.terms, existing.filter((e) => e.id !== channelId), c);
    const [videos] = await tx.select({ n: count() }).from(licensedVideos).where(eq(licensedVideos.licenseId, licenseId));
    if (videos!.n > 0) issues.push('videos_registered');
    const [removed] = await tx
      .select({ n: count() })
      .from(licensedChannels)
      .where(and(eq(licensedChannels.licenseId, licenseId), isNotNull(licensedChannels.removedAt)));
    if (removed!.n >= MAX_CHANNEL_CORRECTIONS) issues.push('correction_limit_reached');
    if (issues.length) return { ok: false, issues };

    await tx.update(licensedChannels).set({ removedAt: new Date() }).where(eq(licensedChannels.id, channelId));
    const [row] = await tx.insert(licensedChannels).values({ licenseId, platform: c.platform, handleOrUrl: c.handleOrUrl }).returning({ id: licensedChannels.id });
    return { ok: true, value: { channelId: row!.id } };
  });
}

/** Registers one creative (PLAN §5.3) under the pinned video_cap; null cap (paid ad) means unlimited. */
export async function registerVideo(db: DbOrTx, actor: BuyerActor, licenseId: string, raw: VideoInput): Promise<Result<{ videoId: string }>> {
  const v = videoInputSchema.parse(raw);
  return db.transaction(async (tx) => {
    const locked = await lockForUsage(tx, actor, licenseId);
    if (!locked.ok) return locked;
    const cap = locked.value.terms.videoCap;
    if (cap !== null) {
      const [videos] = await tx.select({ n: count() }).from(licensedVideos).where(eq(licensedVideos.licenseId, licenseId));
      if (videos!.n >= cap) return { ok: false, issues: ['video_cap_reached'] };
    }
    const [row] = await tx.insert(licensedVideos).values({ licenseId, label: v.label, urls: v.urls }).returning({ id: licensedVideos.id });
    return { ok: true, value: { videoId: row!.id } };
  });
}

/** Adds a cross-post or cut-down URL of an already registered creative; does not count against the cap. */
export async function addVideoUrl(db: DbOrTx, actor: BuyerActor, licenseId: string, videoId: string, rawUrl: string): Promise<Result> {
  const url = videoUrlSchema.parse(rawUrl);
  return db.transaction(async (tx) => {
    const locked = await lockForUsage(tx, actor, licenseId);
    if (!locked.ok) return locked;
    const [video] = await tx
      .select({ urls: licensedVideos.urls })
      .from(licensedVideos)
      .where(and(eq(licensedVideos.id, videoId), eq(licensedVideos.licenseId, licenseId)));
    if (!video) return { ok: false, issues: ['video_not_found'] };
    if (video.urls.includes(url)) return { ok: true, value: undefined };
    if (video.urls.length >= 10) return { ok: false, issues: ['too_many_urls'] };
    await tx
      .update(licensedVideos)
      .set({ urls: sql`array_append(${licensedVideos.urls}, ${url})` })
      .where(eq(licensedVideos.id, videoId));
    return { ok: true, value: undefined };
  });
}
