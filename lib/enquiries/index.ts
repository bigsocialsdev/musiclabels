// Commercial/Broadcast enquiries (PLAN §6.1, §9): types and input schema, safe anywhere.
import { z } from 'zod';

export const ENQUIRY_MEDIA = ['tv', 'ott', 'cinema', 'other'] as const;
export const ENQUIRY_STATUSES = ['new', 'contacted', 'closed_won', 'closed_lost'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** Pipeline moves. Every status can also be closed lost; nothing reopens. */
export const ENQUIRY_TRANSITIONS: readonly { from: EnquiryStatus; to: EnquiryStatus }[] = [
  { from: 'new', to: 'contacted' },
  { from: 'new', to: 'closed_lost' },
  { from: 'contacted', to: 'closed_won' },
  { from: 'contacted', to: 'closed_lost' },
];

export const enquiryInputSchema = z.object({
  trackId: z.uuid(),
  contactName: z.string().trim().min(1).max(200),
  contactEmail: z.email().max(320),
  contactPhone: z.string().trim().max(40).optional(),
  intendedUse: z.string().trim().min(10).max(4000),
  media: z.enum(ENQUIRY_MEDIA),
  budgetRange: z.string().trim().max(100).optional(),
});
export type EnquiryInput = z.input<typeof enquiryInputSchema>;
