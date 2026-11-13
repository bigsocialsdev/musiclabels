import type { StatusTone } from '@/components/ui/status';
import type { DisputeStatus } from '@/lib/disputes';

export const DISPUTE_STATUS_LABEL: Record<DisputeStatus, { tone: StatusTone; label: string }> = {
  open: { tone: 'attention', label: 'Open' },
  in_progress: { tone: 'info', label: 'In progress' },
  resolved_released: { tone: 'ok', label: 'Released' },
  resolved_denied: { tone: 'muted', label: 'Denied' },
  refund_eligible: { tone: 'attention', label: 'Refund eligible' },
  resolved_refunded: { tone: 'ok', label: 'Refunded' },
  resolved_kit_issued: { tone: 'info', label: 'Kit issued' },
};
