'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { previewReceipt, type ReceiptTier } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { consume } from '@/lib/platform/ratelimit';
import { clientIp } from '@/lib/platform/request';

/** Public, read-only: tier prices and the exact GST for a billing state, for the receipt. Throttled per address. */
export async function receiptAction(trackId: string, stateCode?: string): Promise<ReceiptTier[] | null> {
  const id = z.uuid().safeParse(trackId);
  if (!id.success) return null;
  if (!(await consume(`receipt:${clientIp(await headers()) ?? 'unknown'}`, { capacity: 60, refillPerSecond: 1 }))) return null;
  return previewReceipt(getDb(), id.data, stateCode?.slice(0, 2));
}
