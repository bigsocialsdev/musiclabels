/**
 * Client IP for evidence fields (acceptances). Prefers headers the platform sets itself:
 * Vercel overwrites x-vercel-forwarded-for and x-real-ip, whereas x-forwarded-for can be client-supplied elsewhere.
 */
export function clientIp(h: Pick<Headers, 'get'>): string | null {
  const raw = h.get('x-vercel-forwarded-for') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for');
  return raw?.split(',')[0]?.trim() || null;
}
