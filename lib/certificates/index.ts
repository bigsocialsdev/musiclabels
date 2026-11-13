/** PLAN §7: individuals are shown as first letter + asterisks per name part unless they opt in (S4-M9). */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => {
      const chars = [...part];
      return chars[0] + '*'.repeat(Math.max(chars.length - 1, 1));
    })
    .join(' ');
}

export const TIER_LABELS = { creator: 'Creator', brand_organic: 'Brand Organic', paid_ad: 'Paid Ad Campaign' } as const;

/** Product copy rule (CLAUDE.md): clearance is a process, never a promise. Final wording is [Lawyer]. */
export const CLEARANCE_NOTICE =
  'Clearance is a process, not a guarantee. The platform and the rights holder act on claims as described in the license text; outcomes on third-party platforms are outside our control.';
