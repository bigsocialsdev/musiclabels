import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * Stand-in for the Razorpay REST API, for e2e runs with no Razorpay account or network. The app is pointed at it with
 * RAZORPAY_API_URL. Every order it creates counts as paid by the payment `pay_<order id>`, captured for the order's amount:
 * the fake checkout script (golden-path spec) hands the app that id and a signature made with the same key secret, and
 * the app then re-fetches the payment from here exactly as it does from Razorpay.
 */
export const razorpayUrl = () => process.env.RAZORPAY_API_URL ?? 'http://127.0.0.1:54399/v1';
const PAYMENT_PREFIX = 'pay_';
export const paymentIdFor = (gatewayOrderId: string) => `${PAYMENT_PREFIX}${gatewayOrderId}`;

/** What Razorpay Checkout's success handler signs: `order_id|payment_id` with the key secret. */
export const checkoutSignature = (secret: string, gatewayOrderId: string, paymentId: string) =>
  createHmac('sha256', secret).update(`${gatewayOrderId}|${paymentId}`, 'utf8').digest('hex');

export function startFakeRazorpay(): Promise<Server> {
  const orders = new Map<string, { amount: number; currency: string }>();
  const payment = (orderId: string) => ({
    id: paymentIdFor(orderId),
    order_id: orderId,
    amount: orders.get(orderId)!.amount,
    currency: orders.get(orderId)!.currency,
    status: 'captured',
    created_at: Math.floor(Date.now() / 1000),
  });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = new URL(req.url ?? '/', 'http://x').pathname.replace(/^\/v1/, '');
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(body));
    };
    let m: RegExpMatchArray | null;
    if (req.method === 'POST' && path === '/orders') {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { amount: number; currency: string };
      const id = `order_e2e${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      orders.set(id, { amount: body.amount, currency: body.currency });
      send(200, { id, entity: 'order', amount: body.amount, currency: body.currency, status: 'created' });
    } else if (req.method === 'GET' && (m = path.match(new RegExp(`^/payments/${PAYMENT_PREFIX}(.+)$`))) && orders.has(m[1]!)) {
      send(200, payment(m[1]!));
    } else if (req.method === 'GET' && (m = path.match(/^\/orders\/([^/]+)\/payments$/)) && orders.has(m[1]!)) {
      send(200, { items: [payment(m[1]!)] });
    } else {
      send(404, { error: { description: `fake Razorpay: no route for ${req.method} ${path}` } });
    }
  });
  return new Promise((resolve) => server.listen(Number(new URL(razorpayUrl()).port), '127.0.0.1', () => resolve(server)));
}
