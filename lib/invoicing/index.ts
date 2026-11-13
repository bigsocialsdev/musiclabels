// Pure GST rules (PLAN §8.2): safe anywhere.

/** GST state/UT codes in current use (25 and 28 were retired by mergers). */
export const GST_STATES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

export const isGstStateCode = (code: string) => Object.hasOwn(GST_STATES, code);

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Format (state code + PAN + entity + Z + check) and the mod-36 check character. */
export function isValidGstin(raw: string): boolean {
  const g = raw.trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g) || !isGstStateCode(g.slice(0, 2))) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(g[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

export type GstBreakdown = {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  gstRateBps: number;
  placeOfSupplyState: string;
  intraState: boolean;
};

/** round(n / d) half-up, in exact integer arithmetic (n, d ≥ 0). */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/**
 * Same state as the supplier → CGST + SGST at half the rate each; otherwise IGST at the full rate.
 * Each component rounds half-up on its own (CLAUDE.md); total = taxable + taxes.
 */
export function computeGst(input: { taxablePaise: number; gstRateBps: number; supplierStateCode: string; placeOfSupplyState: string }): GstBreakdown {
  const { taxablePaise, gstRateBps, supplierStateCode, placeOfSupplyState } = input;
  if (!Number.isSafeInteger(taxablePaise) || taxablePaise <= 0) throw new Error('taxable value must be a positive integer of paise');
  if (!Number.isInteger(gstRateBps) || gstRateBps < 0 || gstRateBps > 10_000) throw new Error('invalid GST rate');
  const taxable = BigInt(taxablePaise);
  const intraState = supplierStateCode === placeOfSupplyState;
  const half = intraState ? Number(divRoundHalfUp(taxable * BigInt(gstRateBps), 20_000n)) : 0;
  const igst = intraState ? 0 : Number(divRoundHalfUp(taxable * BigInt(gstRateBps), 10_000n));
  return {
    taxablePaise,
    cgstPaise: half,
    sgstPaise: half,
    igstPaise: igst,
    totalPaise: taxablePaise + 2 * half + igst,
    gstRateBps,
    placeOfSupplyState,
    intraState,
  };
}

/** GSTIN state if a GSTIN is given, else the (mandatory) billing state. */
export function placeOfSupply(recipientGstin: string | null, billingStateCode: string): string {
  return recipientGstin ? recipientGstin.slice(0, 2) : billingStateCode;
}

/** Indian financial year (April–March, by the IST calendar) as `2026-27`. */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export const SERIES_PREFIX = { invoice: 'MRM', credit_note: 'MCN' } as const;
export type SeriesKind = keyof typeof SERIES_PREFIX;

/** `MRM/26-27/000123`: 16 characters, the GST limit. */
export function formatDocumentNumber(kind: SeriesKind, fy: string, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999) throw new Error(`document number ${n} out of range for one financial year`);
  return `${SERIES_PREFIX[kind]}/${fy.slice(2)}/${String(n).padStart(6, '0')}`;
}

export const formatInr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
