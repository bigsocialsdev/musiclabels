import { TIERS, getTermsVersion, quoteLicense, type Tier } from '@/lib/licensing/server';
import { computeGst, getBillingConfig, isGstStateCode, type GstBreakdown } from '@/lib/invoicing/server';
import type { DbOrTx } from '@/lib/platform/db';

export type ReceiptTier = {
  tier: Tier;
  /** False when this tier cannot be bought for the track right now; nothing else is set then. */
  available: boolean;
  /** Taxable value, GST excluded, from the active price book. */
  amountPaise?: number;
  terms?: { termKind: string; termMonths: number | null; videoCap: number | null; maxChannels: number };
  /** The exact tax lines for the billing state asked for. Null when GST is not configured or no state was given. */
  gst?: GstBreakdown | null;
};

/**
 * What the receipt on a track page shows: each tier's price and terms, and the exact GST for a billing state. The same
 * quote and tax functions as checkout, so the page and the order agree; the order still snapshots at creation.
 * Display only: nothing here is trusted back from the browser.
 */
export async function previewReceipt(db: DbOrTx, trackId: string, billingStateCode?: string): Promise<ReceiptTier[]> {
  const state = billingStateCode && isGstStateCode(billingStateCode) ? billingStateCode : null;
  let billing: ReturnType<typeof getBillingConfig> | null = null;
  try {
    billing = getBillingConfig();
  } catch {
    billing = null; // GST not configured in this environment: show prices without tax lines
  }
  return Promise.all(
    TIERS.map(async (tier): Promise<ReceiptTier> => {
      const q = await quoteLicense(db, trackId, tier);
      if (!q.ok) return { tier, available: false };
      const t = await getTermsVersion(db, q.value.termsVersionId);
      return {
        tier,
        available: true,
        amountPaise: q.value.amountPaise,
        terms: t ? { termKind: t.termKind, termMonths: t.termMonths, videoCap: t.videoCap, maxChannels: t.maxChannels } : undefined,
        gst: state && billing ? computeGst({ taxablePaise: q.value.amountPaise, gstRateBps: billing.gstRateBps, supplierStateCode: billing.supplierStateCode, placeOfSupplyState: state }) : null,
      };
    }),
  );
}

