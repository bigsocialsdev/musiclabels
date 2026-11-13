// Clearance request state machine (PLAN §4.5) and shared types: safe anywhere.
import { z } from 'zod';

export const CLEARANCE_STATUSES = ['not_required', 'pending', 'sent', 'completed', 'failed', 'overdue', 'escalated'] as const;
export type ClearanceStatus = (typeof CLEARANCE_STATUSES)[number];

export const CLEARANCE_EVENTS = ['send', 'complete', 'fail', 'mark_overdue', 'escalate'] as const;
export type ClearanceEvent = (typeof CLEARANCE_EVENTS)[number];

/** PLAN §4.5. `not_required` (Class A) is a resting state: nothing to release, so it has no transitions. */
export const CLEARANCE_TRANSITIONS: readonly { from: ClearanceStatus; event: ClearanceEvent; to: ClearanceStatus }[] = [
  { from: 'pending', event: 'send', to: 'sent' },
  { from: 'sent', event: 'complete', to: 'completed' },
  { from: 'sent', event: 'fail', to: 'failed' },
  { from: 'sent', event: 'mark_overdue', to: 'overdue' },
  { from: 'overdue', event: 'complete', to: 'completed' },
  { from: 'overdue', event: 'fail', to: 'failed' },
  { from: 'overdue', event: 'escalate', to: 'escalated' },
  { from: 'escalated', event: 'complete', to: 'completed' },
  { from: 'escalated', event: 'fail', to: 'failed' },
];

export function nextClearanceStatus(from: ClearanceStatus, event: ClearanceEvent): ClearanceStatus | null {
  return CLEARANCE_TRANSITIONS.find((t) => t.from === from && t.event === event)?.to ?? null;
}

/** States in which the seller can still answer. */
export const AWAITING_SELLER: readonly ClearanceStatus[] = ['sent', 'overdue', 'escalated'];

/** What the seller sends back through the response link. */
export const clearanceResponseSchema = z.object({
  outcome: z.enum(['released', 'declined']),
  note: z.string().trim().max(2000).optional(),
});
export type ClearanceResponse = z.infer<typeof clearanceResponseSchema>;

/** A response link token is 32 random bytes, base64url: 43 characters. */
export const RESPONSE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
