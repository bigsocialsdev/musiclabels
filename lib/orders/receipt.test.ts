import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/lib/platform/db';
import { setupCommerce } from '@/tests/commerce';
import { makeSellableTrack } from '@/tests/factories';
import { previewReceipt } from './server';

afterAll(closeDb);
const db = getDb();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 200_000, L3: 300_000, L4: 400_000, L5: 500_000 }));

describe('the receipt on a track page', () => {
  it('shows each tier’s price and the exact GST for the billing state, from integer paise', async () => {
    const t = await makeSellableTrack(db, { priceLevel: 'L2' });
    const supplierState = (await import('@/lib/invoicing/server')).getBillingConfig().supplierStateCode;
    const home = await previewReceipt(db, t.trackId, supplierState);
    expect(home.map((r) => r.tier)).toEqual(['creator', 'brand_organic', 'paid_ad']);
    expect(home[0]).toMatchObject({ available: true, amountPaise: 200_000, gst: { taxablePaise: 200_000, igstPaise: 0, intraState: true } });
    expect(home[0]!.gst!.cgstPaise).toBe(home[0]!.gst!.sgstPaise);
    expect(home[0]!.gst!.totalPaise).toBe(200_000 + 2 * home[0]!.gst!.cgstPaise);
    expect(home[2]!.terms).toMatchObject({ termKind: 'fixed_months', termMonths: 12 }); // paid ads: a 12-month term

    const away = await previewReceipt(db, t.trackId, supplierState === '07' ? '27' : '07');
    expect(away[0]!.gst).toMatchObject({ cgstPaise: 0, sgstPaise: 0, intraState: false });
    expect(away[0]!.gst!.igstPaise).toBeGreaterThan(0);
  });

  it('leaves a tier out when it cannot be bought, and shows no tax lines without a valid state', async () => {
    const t = await makeSellableTrack(db, { paidAds: false });
    const r = await previewReceipt(db, t.trackId, 'XX');
    expect(r.find((x) => x.tier === 'paid_ad')).toEqual({ tier: 'paid_ad', available: false });
    expect(r.find((x) => x.tier === 'creator')).toMatchObject({ available: true, gst: null });
    const gone = await makeSellableTrack(db, { status: 'draft' });
    expect((await previewReceipt(db, gone.trackId)).every((x) => !x.available)).toBe(true);
  });
});
