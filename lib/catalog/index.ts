// Types and the pure transition table: safe anywhere.
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
