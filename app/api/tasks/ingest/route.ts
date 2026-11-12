import { z } from 'zod';
import { processVersion } from '@/lib/catalog/server';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // ffmpeg passes over a 15-minute master (about 20 s on a laptop; unverified on Vercel)

const body = z.object({ id: z.uuid() });

/** Re-run ingest + screening for one track version (admin "re-run" action). Takes only an id; state is re-read from the DB. */
export async function POST(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'task');
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 });
  return Response.json(await processVersion(parsed.data.id));
}
