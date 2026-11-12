import { z } from 'zod';
import { fulfilOrder, productionDeps } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { rejectUnlessAuthorized } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const body = z.object({ id: z.uuid() });

/** Re-run fulfilment for one order (admin "re-run" action). Takes only an id; state is re-read from the DB. */
export async function POST(req: Request) {
  const denied = rejectUnlessAuthorized(req, 'task');
  if (denied) return denied;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 });
  return Response.json({ result: await fulfilOrder(getDb(), parsed.data.id, productionDeps().store) });
}
