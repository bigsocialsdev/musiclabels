import { PRICE_LEVELS } from '@/lib/catalog';
import { TIERS } from '@/lib/licensing';

/** Rupees as typed ("1999" or "1999.50") to integer paise, by string arithmetic: no floats near money. Null when it is not a positive amount of at most two decimals. */
export function rupeesToPaise(text: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return paise > 0 ? paise : null;
}

export const priceField = (level: string, tier: string) => `${level}__${tier}`;

/** The full level × tier grid from a submitted form, or null when any price is missing or malformed. */
export function parsePriceGrid(fields: Record<string, FormDataEntryValue>) {
  const grid = [];
  for (const priceLevel of PRICE_LEVELS) {
    for (const tier of TIERS) {
      const v = fields[priceField(priceLevel, tier)];
      const amountPaise = typeof v === 'string' ? rupeesToPaise(v) : null;
      if (amountPaise === null) return null;
      grid.push({ priceLevel, tier, amountPaise });
    }
  }
  return grid;
}
