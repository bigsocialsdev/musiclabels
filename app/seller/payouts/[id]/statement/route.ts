import { z } from 'zod';
import { sellerStatementUrl } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { requireSellerSession } from '../../../session';

export const dynamic = 'force-dynamic';

/** Sends the signed-in seller to a short-lived download link for their own payout statement. Anything else is a 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return new Response('Not found', { status: 404 });
  const { session, orgId } = await requireSellerSession(`/seller/payouts/${parsed.data}/statement`);
  const url = orgId ? await sellerStatementUrl(getDb(), { userId: session.userId, orgId }, parsed.data) : null;
  if (!url) return new Response('Not found', { status: 404 });
  return Response.redirect(url, 302);
}
