// Types and the pure transition table: safe anywhere.
import { z } from 'zod';
export const TRACK_STATUSES = ['draft', 'submitted', 'in_review', 'published', 'rejected', 'suspended', 'delisted'] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];

export const TRACK_EVENTS = [
  'submit',
  'ingest_screen_done',
  'approve',
  'reject',
  'classify_c',
  'edit',
  'suspend',
  'reinstate',
  'delist',
] as const;
export type TrackEvent = (typeof TRACK_EVENTS)[number];

export type Transition = { from: TrackStatus; event: TrackEvent; to: TrackStatus };

/** PLAN section 4.1. The only way a track's status changes. */
export const TRACK_TRANSITIONS: readonly Transition[] = [
  { from: 'draft', event: 'submit', to: 'submitted' },
  { from: 'submitted', event: 'ingest_screen_done', to: 'in_review' },
  { from: 'in_review', event: 'approve', to: 'published' },
  { from: 'in_review', event: 'reject', to: 'rejected' },
  { from: 'in_review', event: 'classify_c', to: 'rejected' },
  { from: 'rejected', event: 'edit', to: 'draft' },
  { from: 'published', event: 'suspend', to: 'suspended' },
  { from: 'suspended', event: 'reinstate', to: 'published' },
  { from: 'published', event: 'delist', to: 'delisted' },
  { from: 'suspended', event: 'delist', to: 'delisted' },
];

export function nextStatus(from: TrackStatus, event: TrackEvent): TrackStatus | null {
  return TRACK_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
}

/** Only `published` tracks are sellable. */
export const isSellable = (status: TrackStatus) => status === 'published';

export type ClearanceClass = 'unclassified' | 'A' | 'B' | 'C';
export type PriceLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export const PRICE_LEVELS: readonly PriceLevel[] = ['L1', 'L2', 'L3', 'L4', 'L5'];

// ---- inputs (zod) ----

export const LANGUAGES = ['hindi', 'punjabi', 'tamil', 'english', 'instrumental'] as const;
const names = z.array(z.string().trim().min(1).max(120)).max(20);

export const trackInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  primaryArtist: z.string().trim().min(1).max(200),
  featuredArtists: names.default([]),
  composers: names.default([]),
  lyricists: names.default([]),
  genreId: z.uuid().nullable().default(null),
  moodIds: z.array(z.uuid()).max(5).default([]),
  language: z.enum(LANGUAGES),
  bpm: z.number().int().min(30).max(300).nullable().default(null),
  explicit: z.boolean().default(false),
  aiGeneratedDeclared: z.boolean().default(false),
  organicSocial: z.boolean().default(true),
  paidAds: z.boolean().default(false),
  editsAllowed: z.boolean().default(false),
  proposedPriceLevel: z.enum(['L1', 'L2', 'L3', 'L4', 'L5']).nullable().default(null),
});
export type TrackInput = z.input<typeof trackInputSchema>;

export const rightsDeclarationSchema = z.object({
  masterControlled: z.boolean(),
  compositionControlled: z.boolean(),
  coOwnerConsentWarranted: z.boolean(),
  sampleFreeWarranted: z.boolean(),
  notACoverWarranted: z.boolean(),
  registrations: z
    .array(
      z.object({
        system: z.enum(['youtube_cid', 'meta_rm', 'other']),
        administeredBy: z.string().trim().min(1).max(200),
        sellerControlsRelease: z.boolean(),
      }),
    )
    .max(10)
    .default([]),
});
export type RightsDeclarationInput = z.input<typeof rightsDeclarationSchema>;

export const DOC_TYPES = ['pro_registration', 'distribution_agreement', 'publishing_agreement', 'self_declaration', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Guard failures are returned as a list so the UI can show everything that blocks the action at once. */
export type GuardResult<T = void> = { ok: true; value: T } | { ok: false; issues: string[] };
