import { afterAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/platform/db';
import { POST } from './route';

afterAll(closeDb);

it('answers 429 with retry-after once an address has used its allowance, before the signature is looked at', async () => {
  const ip = `192.0.2.${Date.now() % 250}`;
  await getDb().execute(sql`INSERT INTO rate_limits (key, tokens, updated_at) VALUES (${'razorpay-webhook:' + ip}, 0, now())`);
  const res = await POST(new Request('http://localhost/api/webhooks/razorpay', { method: 'POST', body: '{}', headers: { 'x-real-ip': ip } }));
  expect(res.status).toBe(429);
  expect(res.headers.get('retry-after')).toBe('30');
});
