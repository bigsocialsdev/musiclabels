import { z } from 'zod';
import { buyerDocumentUrl, renderDisputeKitForBuyer } from '@/lib/certificates/server';
import { loadSession, requireVerified } from '@/lib/identity/server';
import { resolveBuyerActor } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { consume } from '@/lib/platform/ratelimit';

export const dynamic = 'force-dynamic';

const params = z.object({ id: z.uuid(), doc: z.enum(['certificate', 'invoice', 'credit-note', 'dispute-kit']) });

/** Buyer documents: certificate, invoice and credit note redirect to a 15-minute signed URL; the dispute kit renders on request. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; doc: string }> }) {
  const p = params.safeParse(await ctx.params);
  if (!p.success) return new Response('Not found', { status: 404 });
  const guard = requireVerified(await loadSession());
  if (!guard.ok) return new Response('Unauthorized', { status: 401 });
  const db = getDb();
  const actor = await resolveBuyerActor(db, guard.value.userId, p.data.id);
  if (!actor) return new Response('Not found', { status: 404 });

  if (p.data.doc === 'dispute-kit') {
    // Rendered per request (CPU-heavy): cap it per user.
    if (!(await consume(`dispute-kit:${actor.userId}`, { capacity: 10, refillPerSecond: 10 / 3600 }, db))) return new Response('Too many requests', { status: 429 });
    const kit = await renderDisputeKitForBuyer(db, actor, p.data.id);
    if (!kit) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(kit.pdf), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${kit.filename}"`, 'cache-control': 'private, no-store' },
    });
  }
  const url = await buyerDocumentUrl(db, actor, p.data.id, p.data.doc);
  if (!url) return new Response('Not ready yet', { status: 404 });
  return Response.redirect(url, 303);
}
