import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import { clearanceRequests, outbox } from '@/db/schema';
import { GET, POST } from '@/app/api/clearance/respond/[token]/route';
import { closeDb, getDb } from '@/lib/platform/db';
import { sale, setupCommerce } from '@/tests/commerce';
import { FakeGateway, MemoryStore } from '@/tests/fakes';
import { hashToken } from './server';

afterAll(closeDb);
const db = getDb();
const gw = new FakeGateway();
const store = new MemoryStore();

beforeAll(() => setupCommerce(db, { L1: 100_000, L2: 100_000, L3: 100_000, L4: 100_000, L5: 100_000 }));

async function newLink() {
  const s = await sale(db, gw, store, { clearanceClass: 'B' });
  const [r] = await db.select().from(clearanceRequests).where(eq(clearanceRequests.licenseId, s.licenseId!));
  const mails = await db.select().from(outbox).where(eq(outbox.template, 'clearance_request')).orderBy(desc(outbox.createdAt)).limit(100);
  const token = mails.map((m) => (m.payload as { respondUrl: string }).respondUrl.split('/').pop()!).find((t) => hashToken(t) === r!.respondTokenHash)!;
  return { token, licenseId: s.licenseId!, requestId: r!.id };
}
const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const form = (fields: Record<string, string>) => new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams(fields), headers: { 'x-real-ip': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
const get = () => new Request('http://localhost/x', { headers: { 'x-real-ip': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });

describe('GET/POST /api/clearance/respond/[token]', () => {
  it('shows the request without consuming the link, and never lets the page be cached or indexed', async () => {
    const { token } = await newLink();
    for (let i = 0; i < 2; i++) {
      const res = await GET(get(), ctx(token));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await res.text();
      expect(html).toContain('<form method="post">');
      expect(html).toContain('@b');
      expect(html).not.toContain(token); // the form posts to the same URL; the page never echoes the credential
    }
  });

  it('POST records the answer once; the link is then dead', async () => {
    const { token, requestId } = await newLink();
    const ok = await POST(form({ outcome: 'released', note: '<script>x</script>' }), ctx(token));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Thank you');
    expect((await db.select().from(clearanceRequests).where(eq(clearanceRequests.id, requestId)))[0]).toMatchObject({ status: 'completed', sellerNote: '<script>x</script>' });
    expect((await POST(form({ outcome: 'declined' }), ctx(token))).status).toBe(404);
    expect((await GET(get(), ctx(token))).status).toBe(404);
  });

  it('an unanswered form is a 400 that keeps the link alive; malformed and unknown tokens are 404s', async () => {
    const { token } = await newLink();
    expect((await POST(form({}), ctx(token))).status).toBe(400);
    expect((await GET(get(), ctx(token))).status).toBe(200);
    expect((await GET(get(), ctx('short'))).status).toBe(404);
    expect((await GET(get(), ctx('A'.repeat(43)))).status).toBe(404);
    expect((await POST(form({ outcome: 'released' }), ctx('../../etc/passwd'))).status).toBe(404);
  });

  it('is rate limited per address', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`; // fresh bucket on every run
    const same = () => new Request('http://localhost/x', { headers: { 'x-real-ip': ip } });
    const codes: number[] = [];
    for (let i = 0; i < 30; i++) codes.push((await GET(same(), ctx('A'.repeat(43)))).status);
    expect(codes).toContain(429);
    expect(codes[0]).toBe(404);
  });
});
