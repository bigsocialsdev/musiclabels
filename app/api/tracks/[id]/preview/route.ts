import { z } from 'zod';
import { previewUrl } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { consume } from '@/lib/platform/ratelimit';
import { clientIp } from '@/lib/platform/request';

export const dynamic = 'force-dynamic';

/**
 * The player's audio source: a redirect to a short-lived signed link for the track's preview (the audible-watermarked
 * file; masters and clean files are never reachable here). Public, so it is throttled per address.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response('Not found', { status: 404 });
  if (!(await consume(`preview:${clientIp(req.headers) ?? 'unknown'}`, { capacity: 60, refillPerSecond: 1 }))) {
    return new Response('Too many requests', { status: 429, headers: { 'retry-after': '30' } });
  }
  const url = await previewUrl(getDb(), id.data);
  if (!url) return new Response('Not found', { status: 404 });
  // Cached briefly so seeking inside one listen reuses the link instead of signing again (the link lives 10 minutes).
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'private, max-age=300' } });
}
