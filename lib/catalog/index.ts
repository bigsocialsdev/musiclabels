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
export const PRICE_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;
export type PriceLevel = (typeof PRICE_LEVELS)[number];

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
  proposedPriceLevel: z.enum(PRICE_LEVELS).nullable().default(null),
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

// ---- discovery (S4-M8): the public search contract, safe anywhere ----

export const DISCOVERY_TIERS = ['creator', 'brand_organic', 'paid_ad'] as const;
export type DiscoveryTier = (typeof DISCOVERY_TIERS)[number];
export const DISCOVERY_SORTS = ['relevance', 'licensed', 'newest'] as const;
export const DISCOVERY_PAGE_SIZE = 24;

/** Filters read from the URL. Lists: any of the values within a facet; across facets they all apply (AND). */
export const discoverySearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  genre: z.array(z.uuid()).max(10).default([]),
  mood: z.array(z.uuid()).max(10).default([]),
  lang: z.array(z.enum(LANGUAGES)).max(5).default([]),
  /** Price levels (the platform's L1 to L5). */
  price: z.array(z.enum(PRICE_LEVELS)).max(5).default([]),
  /** Tiers a track must offer, all of them. */
  tier: z.array(z.enum(DISCOVERY_TIERS)).max(3).default([]),
  bpmMin: z.number().int().min(30).max(300).optional(),
  bpmMax: z.number().int().min(30).max(300).optional(),
  /** Length in seconds. */
  durMin: z.number().int().min(0).max(3600).optional(),
  durMax: z.number().int().min(0).max(3600).optional(),
  sort: z.enum(DISCOVERY_SORTS).default('relevance'),
  page: z.number().int().min(1).max(500).default(1),
});
export type DiscoverySearch = z.output<typeof discoverySearchSchema>;

/** What a result row, the stage and the track page need; storage keys never leave the slice. */
export type TrackCard = {
  id: string;
  slug: string;
  title: string;
  primaryArtist: string;
  language: (typeof LANGUAGES)[number];
  bpm: number | null;
  durationMs: number;
  genre: string | null;
  moods: string[];
  priceLevel: PriceLevel;
  /** Tiers that can be bought right now (usage flag and a price in the active book). */
  tiers: DiscoveryTier[];
};

export type FacetOption = { value: string; label: string; count: number };
export type DiscoveryFacets = {
  genres: FacetOption[];
  moods: FacetOption[];
  languages: FacetOption[];
  tiers: FacetOption[];
  priceLevels: FacetOption[];
  bpm: { min: number; max: number } | null;
};
