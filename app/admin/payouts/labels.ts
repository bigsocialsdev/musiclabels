import type { StatusTone } from '@/components/ui/status';

export const BATCH_STATUS: Record<string, { tone: StatusTone; label: string }> = {
  draft: { tone: 'muted', label: 'Draft' },
  computed: { tone: 'attention', label: 'Awaiting approval' },
  approved: { tone: 'info', label: 'Approved' },
  processing: { tone: 'info', label: 'With the bank' },
  completed: { tone: 'ok', label: 'Completed' },
};

export const LINE_STATUS: Record<string, { tone: StatusTone; label: string }> = {
  pending: { tone: 'muted', label: 'Pending' },
  processing: { tone: 'info', label: 'Sent to the bank' },
  paid: { tone: 'ok', label: 'Paid' },
  failed: { tone: 'blocked', label: 'Failed' },
};
