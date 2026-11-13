// Seller onboarding inputs and constants: safe anywhere (forms import the schemas).
import { z } from 'zod';

export const ENTITY_TYPES = ['individual', 'company', 'partnership', 'llp'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const KYC_DOC_KINDS = ['pan_card', 'id_proof', 'gst_certificate', 'bank_proof'] as const;
export type KycDocKind = (typeof KYC_DOC_KINDS)[number];

export const KYC_STATUSES = ['pending', 'verified', 'rejected'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** Format only (state code, PAN, entity, Z, check character); the registry check is a finance task. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const optionalGstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_PATTERN, 'invalid GSTIN')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const sellerProfileInputSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  gstin: optionalGstin,
  opsContactEmail: z.email().max(320),
  opsContactPhone: z.string().trim().max(30).optional(),
});
export type SellerProfileInput = z.input<typeof sellerProfileInputSchema>;

export const newSellerInputSchema = sellerProfileInputSchema.extend({
  legalName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(120),
  /** Sellers warrant worldwide rights at onboarding (PLAN §6); a seller without them cannot list. */
  worldwideRightsWarranted: z.literal(true, { error: 'You must confirm you hold worldwide rights' }),
});
export type NewSellerInput = z.input<typeof newSellerInputSchema>;

export const panSchema = z.string().trim().toUpperCase().regex(PAN_PATTERN, 'invalid PAN');
