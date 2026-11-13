import type { StatusTone } from '@/components/ui/status';
import type { TrackStatus } from '@/lib/catalog';

export const STATUS_LABELS: Record<TrackStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In review',
  published: 'Published',
  rejected: 'Needs changes',
  suspended: 'Suspended',
  delisted: 'Delisted',
};

export const statusTone = (s: TrackStatus): StatusTone =>
  s === 'published' ? 'ok' : s === 'rejected' || s === 'suspended' ? 'blocked' : s === 'submitted' || s === 'in_review' ? 'info' : 'muted';

/** Upload checks (KYC and rights documents): valid, rejected, or still checking. */
export const checkTone = (s: string): StatusTone => (s === 'valid' ? 'ok' : s === 'rejected' ? 'blocked' : 'attention');
