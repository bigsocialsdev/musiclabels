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

export const statusVariant = (s: TrackStatus) => (s === 'published' ? 'default' : s === 'rejected' || s === 'suspended' ? 'destructive' : 'outline');
