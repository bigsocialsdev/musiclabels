export type ScreenMatch = {
  title: string;
  artist: string;
  label?: string;
  score?: number;
  source: 'acrcloud' | 'internal_duplicate';
};

export type ScreenStatus = 'clean' | 'match' | 'error' | 'unavailable';
export type ScreenResult = { status: ScreenStatus; matches: ScreenMatch[] };

export type ClaimPlatform = 'youtube' | 'meta';
export type ObservedClaim = { claimant: string; policy: string };

/** PLAN section 11. A second vendor implements this; the handler and tables do not change. */
export interface FingerprintScreener {
  readonly id: string;
  /** `audioFile` is a local copy of the version's 320 kbps MP3 derivative. */
  screen(input: { audioFile: string; durationMs: number }): Promise<ScreenResult>;
}
