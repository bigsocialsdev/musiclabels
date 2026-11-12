import { z } from 'zod';
import { PRICE_LEVELS } from '@/lib/catalog';
import { TIERS } from '@/lib/licensing';

export const PRICE_BOOK_STATUSES = ['draft', 'active', 'retired'] as const;
export type PriceBookStatus = (typeof PRICE_BOOK_STATUSES)[number];

/** A book must price every level × tier pair, so any published track can be quoted under any active book. */
export const priceBookEntriesSchema = z
  .array(
    z.object({
      priceLevel: z.enum(PRICE_LEVELS),
      tier: z.enum(TIERS),
      amountPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }),
  )
  .refine((es) => new Set(es.map((e) => `${e.priceLevel}/${e.tier}`)).size === es.length, 'duplicate level/tier entry')
  .refine((es) => es.length === PRICE_LEVELS.length * TIERS.length, 'every price level × tier must be priced');
export type PriceBookEntryInput = z.input<typeof priceBookEntriesSchema>[number];

export type Price = { priceBookId: string; priceBookVersion: number; amountPaise: number };
