import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { channelVerifications } from '@/db/schema';
import { writeAudit } from '@/lib/audit/server';
import { requirePermission, type AdminContext } from '@/lib/identity';
import { getChannelById, getChannelForBuyer, setChannelVerification, type BuyerActor, type ChannelRef } from '@/lib/licensing/server';
import type { DbOrTx } from '@/lib/platform/db';
import { getEnv } from '@/lib/platform/env';
import { errorMessage, log } from '@/lib/platform/log';
import { consume } from '@/lib/platform/ratelimit';

/** Reads the public description ("bio") of a channel, or null when it cannot be found or checked. */
export type BioFetcher = (channel: { platform: string; handleOrUrl: string }) => Promise<string | null>;

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O/1/I/L
export const newBioCode = () => 'MRM-' + [...randomBytes(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

/**
 * `@handle`, a bare handle, a UC… channel id, or a youtube.com URL of either form. Anything else (custom `/c/`
 * names, other hosts) is not auto-checkable. Only the extracted handle or id ever reaches the API; the buyer's
 * text is never fetched as a URL.
 */
export function parseYoutubeChannel(handleOrUrl: string): { handle: string } | { id: string } | null {
  const s = handleOrUrl.trim();
  let path = s;
  const isUrl = /^https?:\/\//i.test(s);
  if (isUrl) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (!YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) return null;
    path = u.pathname.replace(/^\/+/, '');
  }
  const channel = /^channel\/(UC[\w-]{22})\/?$/.exec(path);
  if (channel) return { id: channel[1]! };
  // In a URL only an @handle path names a channel (not /watch, /playlist, ...); a bare name needs no @.
  const handle = (isUrl ? /^@([\w.-]{3,30})\/?$/ : /^@?([\w.-]{3,30})$/).exec(path);
  if (handle && !/^UC[\w-]{22}$/.test(path)) return { handle: `@${handle[1]}` };
  const bareId = /^UC[\w-]{22}$/.exec(path);
  return bareId ? { id: bareId[0] } : null;
}

/** YouTube Data API v3 `channels.list`, public description only (PLAN §11). Instagram and Facebook are confirmed by an admin. */
export function youtubeBioFetcher(apiKey: string, fetchFn: typeof fetch = fetch): BioFetcher {
  return async ({ platform, handleOrUrl }) => {
    if (platform !== 'youtube') return null;
    const target = parseYoutubeChannel(handleOrUrl);
    if (!target) return null;
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'snippet');
    if ('id' in target) url.searchParams.set('id', target.id);
    else url.searchParams.set('forHandle', target.handle);
    const res = await fetchFn(url, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    const body = (await res.json()) as { items?: { snippet?: { description?: string } }[] };
    return body.items?.[0]?.snippet?.description ?? null;
  };
}

/** The production fetcher, or null without YOUTUBE_API_KEY (then an admin confirms every channel). */
export function productionBioFetcher(): BioFetcher | null {
  const key = getEnv().YOUTUBE_API_KEY;
  return key ? youtubeBioFetcher(key) : null;
}

export type Challenge = { code: string; autoCheck: boolean };

/**
 * Starts (or returns the open) bio-code challenge for a channel the buyer's org owns: the buyer puts the code in
 * the channel description, then asks us to check. Verification only proves control of the channel; it does not
 * gate clearance.
 */
export async function startBioCodeVerification(db: DbOrTx, actor: BuyerActor, channelId: string): Promise<{ ok: true; value: Challenge } | { ok: false; reason: 'not_found' | 'already_verified' }> {
  const channel = await getChannelForBuyer(db, actor, channelId);
  if (!channel) return { ok: false, reason: 'not_found' };
  if (channel.verificationStatus === 'verified') return { ok: false, reason: 'already_verified' };
  const autoCheck = channel.platform === 'youtube' && productionBioFetcher() !== null;
  return db.transaction(async (tx) => {
    const code = newBioCode();
    const [row] = await tx
      .insert(channelVerifications)
      .values({ licensedChannelId: channel.id, method: 'bio_code', code })
      .onConflictDoNothing()
      .returning({ code: channelVerifications.code });
    const open = row ?? (await tx.select({ code: channelVerifications.code }).from(channelVerifications).where(and(eq(channelVerifications.licensedChannelId, channel.id), eq(channelVerifications.status, 'pending'))))[0]!;
    await setChannelVerification(tx, channel.id, 'pending');
    return { ok: true as const, value: { code: open.code, autoCheck } };
  });
}

/** The channel and its open code, for the verify page; `code` is null until the buyer asks for one. */
export async function getBioChallenge(db: DbOrTx, actor: BuyerActor, channelId: string) {
  const channel = await getChannelForBuyer(db, actor, channelId);
  if (!channel) return null;
  const [open] = await db.select({ code: channelVerifications.code }).from(channelVerifications).where(and(eq(channelVerifications.licensedChannelId, channel.id), eq(channelVerifications.status, 'pending')));
  return { channel, code: open?.code ?? null, autoCheck: channel.platform === 'youtube' && productionBioFetcher() !== null };
}

export type CheckResult = 'verified' | 'code_not_found' | 'manual_check_required' | 'check_failed' | 'rate_limited' | 'no_challenge';

/**
 * Checks the channel description for the code. YouTube only (with an API key); other platforms and a missing key
 * say `manual_check_required`. Each call costs API quota, so a person can check a few times a minute at most.
 */
export async function checkBioCode(db: DbOrTx, actor: BuyerActor, channelId: string, fetcher: BioFetcher | null = productionBioFetcher()): Promise<{ ok: true; value: CheckResult } | { ok: false; reason: 'not_found' }> {
  const channel = await getChannelForBuyer(db, actor, channelId);
  if (!channel) return { ok: false, reason: 'not_found' };
  const [challenge] = await db.select().from(channelVerifications).where(and(eq(channelVerifications.licensedChannelId, channel.id), eq(channelVerifications.status, 'pending')));
  if (!challenge) return { ok: true, value: channel.verificationStatus === 'verified' ? 'verified' : 'no_challenge' };
  if (channel.platform !== 'youtube' || !fetcher) return { ok: true, value: 'manual_check_required' };
  if (!(await consume(`bio-check:${actor.userId}`, { capacity: 5, refillPerSecond: 1 / 30 }))) return { ok: true, value: 'rate_limited' };

  let bio: string | null;
  try {
    bio = await fetcher(channel);
  } catch (e) {
    log.error('bio-code fetch failed', { channelId: channel.id, error: errorMessage(e) });
    await db.update(channelVerifications).set({ lastError: errorMessage(e).slice(0, 500) }).where(eq(channelVerifications.id, challenge.id));
    return { ok: true, value: 'check_failed' };
  }
  if (!bio || !bio.toUpperCase().includes(challenge.code)) return { ok: true, value: 'code_not_found' };
  await markVerified(db, channel, challenge.id, null);
  return { ok: true, value: 'verified' };
}

/**
 * The PLAN §11 seam: a buyer proves control of a licensed channel. `bio_code` is the only method; OAuth verifiers
 * (PLAN F4) implement this later. The channel is addressed by id and checked for the acting buyer's org.
 */
export interface ChannelVerifier {
  readonly method: 'bio_code';
  start(db: DbOrTx, actor: BuyerActor, channelId: string): ReturnType<typeof startBioCodeVerification>;
  check(db: DbOrTx, actor: BuyerActor, channelId: string): ReturnType<typeof checkBioCode>;
}

export const bioCodeVerifier: ChannelVerifier = { method: 'bio_code', start: startBioCodeVerification, check: (db, actor, id) => checkBioCode(db, actor, id) };

async function markVerified(db: DbOrTx, channel: ChannelRef, verificationId: string, adminUserId: string | null) {
  await db.transaction(async (tx) => {
    await tx
      .update(channelVerifications)
      .set({ status: 'verified', checkedAt: new Date(), checkedBy: adminUserId, lastError: null })
      .where(and(eq(channelVerifications.id, verificationId), eq(channelVerifications.status, 'pending')));
    await setChannelVerification(tx, channel.id, 'verified');
  });
}

/** An admin confirms a channel by hand (Instagram, Facebook, or YouTube without an API key) after seeing the code in its bio. Audited. */
export async function adminConfirmChannel(db: DbOrTx, admin: AdminContext, channelId: string, ip?: string | null): Promise<{ ok: boolean; reason?: 'not_found' | 'no_challenge' }> {
  requirePermission(admin, 'clearance');
  const channel = await getChannelById(db, channelId);
  if (!channel) return { ok: false, reason: 'not_found' };
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(channelVerifications).where(and(eq(channelVerifications.licensedChannelId, channelId), eq(channelVerifications.status, 'pending'))).for('update');
    if (!challenge) return { ok: false, reason: 'no_challenge' as const };
    await markVerified(tx, channel, challenge.id, admin.userId);
    await writeAudit(tx, { actorUserId: admin.userId, action: 'channel.verify', entityType: 'licensed_channel', entityId: channelId, after: { method: 'bio_code', platform: channel.platform }, ip });
    return { ok: true };
  });
}
