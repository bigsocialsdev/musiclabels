import { z } from 'zod';
import { trackPeaks } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { consume } from '@/lib/platform/ratelimit';
import { clientIp } from '@/lib/platform/request';

export const dynamic = 'force-dynamic';

const bars = z.coerce.number().int().min(20).max(400).catch(120);

/** The bars of a published track's waveform (0 to 1) reduced to `n`, for the row strips and the stage. Public and cacheable. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response('Not found', { status: 404 });
  if (!(await consume(`waveform:${clientIp(req.headers) ?? 'unknown'}`, { capacity: 300, refillPerSecond: 5 }))) {
    return new Response('Too many requests', { status: 429, headers: { 'retry-after': '10' } });
  }
  const n = bars.parse(new URL(req.url).searchParams.get('n') ?? undefined);
  const r = await trackPeaks(getDb(), id.data, n);
  if (!r) return new Response('Not found', { status: 404 });
  return Response.json(r, { headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400' } });
}
