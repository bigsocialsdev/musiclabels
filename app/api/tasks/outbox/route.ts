import { z } from 'zod';
import { processOutbox } from '@/lib/notifications/server';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';

const body = z.object({ id: z.uuid() });

/** Re-run one outbox row (admin "re-run" action). Takes only an id; state is re-read from the DB. */
export async function POST(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'task');
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 });
  return Response.json({ sent: await processOutbox({ id: parsed.data.id }) });
}
