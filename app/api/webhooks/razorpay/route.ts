import { fulfilOrder, handleRazorpayWebhook, productionDeps } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { allowByIp, LIMITS } from '@/lib/platform/ratelimit';
import { kick } from '@/lib/platform/tasks';

export const dynamic = 'force-dynamic';

/** Razorpay webhook (PLAN §8.1). The body is read raw: the HMAC is over the exact bytes Razorpay sent. */
export async function POST(req: Request) {
  // Before the HMAC so a flood of junk posts cannot burn CPU or fill the log; Razorpay's real rate is far below it and retries a 429.
  if (!(await allowByIp('razorpay-webhook', req.headers, LIMITS.webhook))) return new Response(null, { status: 429, headers: { 'retry-after': '30' } });
  const deps = productionDeps();
  const out = await handleRazorpayWebhook(
    getDb(),
    { rawBody: await req.text(), signature: req.headers.get('x-razorpay-signature'), eventId: req.headers.get('x-razorpay-event-id') },
    deps.gateway,
  );
  if (out.fulfilOrderId) {
    const id = out.fulfilOrderId;
    kick('fulfil', () => fulfilOrder(getDb(), id, deps.store));
  }
  return new Response(null, { status: out.status });
}
