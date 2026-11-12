export const LEGAL_KINDS = [
  'tos',
  'privacy',
  'seller_agreement',
  'release_commitment',
  'license_creator',
  'license_brand_organic',
  'license_paid_ad',
] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export type LegalDocument = { id: string; kind: LegalKind; version: number; sha256: string; effectiveAt: Date; bodyMarkdown: string };

/** `no_document` fails closed: nothing published for a required kind means the gate stays shut. */
export type AcceptanceCheck =
  | { ok: true }
  | { ok: false; pending: LegalDocument[]; noDocument: LegalKind[] };
