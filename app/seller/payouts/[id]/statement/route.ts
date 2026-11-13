import { z } from 'zod';
import { sellerStatementUrl } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { requireSellerSession } from '../../../session';

export const dynamic = 'force-dynamic';

/** Sends the signed-in seller to a short-lived download link for their own payout statement. Anything else is a 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, orgId } = await requireSellerSession(`/seller/payouts/${z.uuid().safeParse(id).success ? id : ''}/statement`);
  const parsed = z.uuid().safeParse(id);
  const url = orgId && parsed.success ? await sellerStatementUrl(getDb(), { userId: session.userId, orgId }, parsed.data) : null;
  if (!url) return new Response('Not found', { status: 404 });
  return Response.redirect(url, 302);
}
