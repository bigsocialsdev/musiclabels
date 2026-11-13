// Types, the license transition table and pure helpers: safe anywhere.
import { z } from 'zod';

export const TIERS = ['creator', 'brand_organic', 'paid_ad'] as const;
export type Tier = (typeof TIERS)[number];

export const PLATFORMS = ['youtube', 'instagram', 'facebook'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const LICENSE_STATUSES = ['active', 'expired', 'revoked'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const LICENSE_EVENTS = ['expire', 'revoke'] as const;
export type LicenseEvent = (typeof LICENSE_EVENTS)[number];

export const REVOCATION_REASONS = ['refund', 'chargeback_lost', 'fraud', 'breach'] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

/** PLAN §4.4. Renewal is a new license, never a transition. */
export const LICENSE_TRANSITIONS: readonly { from: LicenseStatus; event: LicenseEvent; to: LicenseStatus }[] = [
  { from: 'active', event: 'expire', to: 'expired' },
  { from: 'active', event: 'revoke', to: 'revoked' },
];

export function nextLicenseStatus(from: LicenseStatus, event: LicenseEvent): LicenseStatus | null {
  return LICENSE_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
}

/** Up to 2 channel replacements per license, only before any video is registered (PLAN §5.3). */
export const MAX_CHANNEL_CORRECTIONS = 2;

/**
 * Status as of `now`. A fixed-term license past ends_at is expired even before the daily sweep stores it,
 * so reads never show a lapsed license as active.
 */
export function effectiveStatus(l: { status: string; endsAt: Date | null }, now: Date = new Date()): LicenseStatus {
  if (l.status === 'active' && l.endsAt && l.endsAt.getTime() <= now.getTime()) return 'expired';
  return l.status as LicenseStatus;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `LIC-XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX`: 26 Crockford base32 characters carrying 128 bits. */
export function formatPublicId(chars26: string): string {
  return `LIC-${chars26.slice(0, 5)}-${chars26.slice(5, 10)}-${chars26.slice(10, 15)}-${chars26.slice(15, 20)}-${chars26.slice(20)}`;
}

/**
 * Parses what a person typed or scanned into the canonical public id, or null. Case-insensitive, ignores
 * dashes and spaces, and applies Crockford's read-alikes (O→0, I/L→1). 128 bits in 26 characters leave the
 * top two bits zero, so the first character is 0–7.
 */
export function normalizePublicId(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.startsWith('LIC')) s = s.slice(3);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 26 || !/^[0-7]/.test(s)) return null;
  for (const c of s) if (!CROCKFORD.includes(c)) return null;
  return formatPublicId(s);
}

export const CROCKFORD_ALPHABET = CROCKFORD;

export type Result<T = void> = { ok: true; value: T } | { ok: false; issues: string[] };

export const channelInputSchema = z.object({
  platform: z.enum(PLATFORMS),
  handleOrUrl: z.string().trim().min(1).max(300),
});
export type ChannelInput = z.input<typeof channelInputSchema>;

const videoUrl = z
  .url({ protocol: /^https$/ })
  .max(2000)
  .transform((u) => u.trim());

/** Links one registered video can carry (cross-posts and cut-downs). */
export const MAX_VIDEO_URLS = 10;

export const videoInputSchema = z.object({
  label: z.string().trim().min(1).max(200),
  urls: z
    .array(videoUrl)
    .min(1)
    .max(MAX_VIDEO_URLS)
    .transform((us) => [...new Set(us)]),
});
export type VideoInput = z.input<typeof videoInputSchema>;
export const videoUrlSchema = videoUrl;
