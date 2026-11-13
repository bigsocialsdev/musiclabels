// Users and orgs admin (PLAN §9, S4-M10c): search, the read-only org summary, suspend and reinstate, the KYC queue. Safe anywhere.
export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_LIMIT = 25;
export const SUSPENSION_REASON_MAX = 1000;

export type SuspendOutcome =
  | { ok: true; pausedTracks: number; sellerSuspended: boolean }
  | { ok: false; reason: 'not_found' | 'already_suspended' };
export type ReinstateOutcome =
  | { ok: true; resumedTracks: number; sellerReinstated: boolean }
  | { ok: false; reason: 'not_found' | 'not_suspended' };
