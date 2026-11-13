// Payout arithmetic, periods and the PayoutRail contract (PLAN §5.6, §8.3, §11): safe anywhere.

export type PayoutTaxConfig = {
  tdsRateBps: number;
  tdsRateNoPanBps: number;
  tdsFyThresholdPaise: number;
  rcmOnUnregistered: boolean;
  gstRateBps: number;
  minPayoutPaise: number;
};

const halfUp = (paise: number, bps: number) => Number((2n * BigInt(paise) * BigInt(bps) + 10_000n) / 20_000n);

/**
 * One seller's payout line. TDS applies once the seller's payouts in the financial year (including this one)
 * exceed the threshold, at the higher rate without a PAN. A GST-registered seller charges GST on top
 * (forward charge, paid to them); for an unregistered seller the platform may owe it under reverse charge
 * (paid to the government, not the seller). Tax rounds half-up per line. All rates and rules are [CA] config.
 */
export function computePayoutLine(input: { basePaise: number; hasPan: boolean; gstRegistered: boolean; fyPaidBeforePaise: number }, cfg: PayoutTaxConfig) {
  const { basePaise } = input;
  if (!Number.isSafeInteger(basePaise) || basePaise <= 0) throw new Error('payout base must be a positive integer of paise');
  const tdsPaise = input.fyPaidBeforePaise + basePaise > cfg.tdsFyThresholdPaise ? halfUp(basePaise, input.hasPan ? cfg.tdsRateBps : cfg.tdsRateNoPanBps) : 0;
  const sellerGstPaise = input.gstRegistered ? halfUp(basePaise, cfg.gstRateBps) : 0;
  const rcmGstPaise = !input.gstRegistered && cfg.rcmOnUnregistered ? halfUp(basePaise, cfg.gstRateBps) : 0;
  return { royaltyBasePaise: basePaise, tdsPaise, sellerGstPaise, rcmGstPaise, netPaise: basePaise - tdsPaise + sellerGstPaise };
}

const IST_OFFSET_MS = 330 * 60_000;

/** A payout period is a calendar month in IST; its cutoff is the first instant of the next month (IST). */
export function periodCutoff(period: string): Date {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw new Error(`invalid payout period ${period}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 1) - IST_OFFSET_MS);
}

/** The month before `now`'s IST month, as YYYY-MM. */
export function previousPeriod(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const istDayOfMonth = (now: Date) => new Date(now.getTime() + IST_OFFSET_MS).getUTCDate();

export type RailLine = { payoutId: string; netPaise: number; accountNumber: string; ifsc: string; accountHolderName: string; reference: string };

/**
 * PLAN §11. `bank_file` ships first (F7); a RazorpayX implementation slots in here once that account exists.
 * `submit` is keyed by payout id, so re-submitting the same lines is safe.
 */
export interface PayoutRail {
  readonly id: 'bank_file' | 'razorpayx';
  submit(batch: { batchId: string; period: string; lines: RailLine[] }): Promise<{ railRef: string }>;
}
