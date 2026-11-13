// Dispute state machine (PLAN §4.6), input schemas and the derived overdue flag: safe anywhere.
import { z } from 'zod';
import { PLATFORMS, videoUrlSchema } from '@/lib/licensing';

export const DISPUTE_STATUSES = ['open', 'in_progress', 'resolved_released', 'resolved_denied', 'refund_eligible', 'resolved_refunded', 'resolved_kit_issued'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const DISPUTE_EVENTS = ['first_action', 'release', 'deny', 'issue_kit', 'make_refund_eligible', 'refund_processed'] as const;
export type DisputeEvent = (typeof DISPUTE_EVENTS)[number];

/**
 * PLAN §4.6. `resolved_kit_issued` can still become refund-eligible on its window ("refund_eligible still applies
 * on its window"); every other resolved state is final. An unresolved dispute, `open` or `in_progress`, becomes
 * refund-eligible when ops misses its resolution deadline (decision after the S3-M6 review; PLAN §4.6 predates it).
 */
export const DISPUTE_TRANSITIONS: readonly { from: DisputeStatus; event: DisputeEvent; to: DisputeStatus }[] = [
  { from: 'open', event: 'first_action', to: 'in_progress' },
  { from: 'open', event: 'make_refund_eligible', to: 'refund_eligible' }, // ops never acted and the resolution deadline passed
  { from: 'in_progress', event: 'release', to: 'resolved_released' },
  { from: 'in_progress', event: 'deny', to: 'resolved_denied' },
  { from: 'in_progress', event: 'make_refund_eligible', to: 'refund_eligible' },
  { from: 'in_progress', event: 'issue_kit', to: 'resolved_kit_issued' },
  { from: 'resolved_kit_issued', event: 'make_refund_eligible', to: 'refund_eligible' },
  { from: 'refund_eligible', event: 'refund_processed', to: 'resolved_refunded' },
];

export function nextDisputeStatus(from: DisputeStatus, event: DisputeEvent): DisputeStatus | null {
  return DISPUTE_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
}

/** Final: nothing more will happen to the dispute. `resolved_kit_issued` is not (a refund window can still apply). */
export const CLOSED_STATUSES: readonly DisputeStatus[] = ['resolved_released', 'resolved_denied', 'resolved_refunded'];

export const DISPUTE_TYPES = ['content_id_claim', 'copyright_strike', 'mute', 'ad_rejection', 'other'] as const;
export type DisputeType = (typeof DISPUTE_TYPES)[number];

/** The 48-hour resolution target backed by the seller contract (locked decision: Class A/B only). */
export const RESOLUTION_TARGET_HOURS = 48;

export const disputeInputSchema = z.object({
  videoUrl: videoUrlSchema,
  platform: z.enum(PLATFORMS),
  disputeType: z.enum(DISPUTE_TYPES),
  claimantName: z.string().trim().min(1).max(200),
});
export type DisputeInput = z.input<typeof disputeInputSchema>;

/**
 * Overdue is derived, never stored (PLAN §4.6: "no SLA engine"): an open dispute past its first-action due date, or
 * an unresolved one past its resolution due date (which exists only for Class A/B tracks).
 */
export function isDisputeOverdue(d: { status: string; firstActionDueAt: Date; resolutionDueAt: Date | null }, now: Date = new Date()): boolean {
  if (d.status === 'open' && now.getTime() > d.firstActionDueAt.getTime()) return true;
  if ((d.status === 'open' || d.status === 'in_progress') && d.resolutionDueAt && now.getTime() > d.resolutionDueAt.getTime()) return true;
  return false;
}

export const COMPLAINT_STATUSES = ['received', 'investigating', 'upheld', 'rejected'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const complaintInputSchema = z.object({
  complainantName: z.string().trim().min(1).max(200),
  complainantEmail: z.email().max(320),
  trackId: z.uuid().optional(),
  workClaimed: z.string().trim().min(10).max(4000),
});
export type ComplaintInput = z.input<typeof complaintInputSchema>;
