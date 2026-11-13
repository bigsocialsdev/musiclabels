import { randomUUID } from 'node:crypto';
import { test } from '@playwright/test';
import postgres from 'postgres';
import { AREAS } from '../../app/admin/areas';
import { expectAccessible } from './axe';
import { signIn } from './fake-auth';

// Signed-in pages, against the database's existing data (run `npm test` or seed first) and a fake Auth server.
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
test.afterAll(async () => sql.end());

type Who = { userId: string; email: string };

test('buyer pages are accessible', async ({ page, context }) => {
  const [row] = await sql<(Who & { id: string; trackId: string })[]>`
    SELECT l.id, l.track_id AS "trackId", u.id AS "userId", u.email FROM licenses l
    JOIN memberships m ON m.org_id = l.purchaser_org_id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
    ORDER BY l.starts_at DESC LIMIT 1`;
  test.skip(!row, 'no license in the database');
  await signIn(context, row!);
  const urls = ['/account', '/licenses', '/invoices', `/licenses/${row!.id}`, `/licenses/${row!.id}/disputes`, `/checkout/${row!.trackId}`];
  for (const url of urls) await expectAccessible(page, url, url);
});

test('seller pages are accessible', async ({ page, context }) => {
  const [row] = await sql<(Who & { id: string })[]>`
    SELECT t.id, u.id AS "userId", u.email FROM tracks t
    JOIN memberships m ON m.org_id = t.seller_org_id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
    JOIN seller_profiles p ON p.org_id = t.seller_org_id AND p.kyc_status = 'verified'
    WHERE t.status = 'published' ORDER BY t.created_at DESC LIMIT 1`;
  test.skip(!row, 'no verified seller with a published track');
  await signIn(context, row!);
  for (const url of ['/seller/onboarding', '/seller/tracks', '/seller/tracks/new', `/seller/tracks/${row!.id}`, '/seller/sales', '/seller/payouts', '/seller/clearance'])
    await expectAccessible(page, url, url);
});

test('admin pages are accessible', async ({ page, context }) => {
  const id = randomUUID();
  const email = `e2e-admin-${id}@example.com`;
  await sql`INSERT INTO users (id, email, verified_at, platform_role, admin_permissions) VALUES (${id}, ${email}, now(), 'admin', ARRAY['superadmin'])`;
  await signIn(context, { userId: id, email, aal: 'aal2' });
  const ids = async (query: Promise<{ id: string }[]>) => (await query).map((r) => r.id);
  const [dispute] = await ids(sql`SELECT id FROM disputes ORDER BY created_at DESC LIMIT 1`);
  const [batch] = await ids(sql`SELECT id FROM payout_batches ORDER BY created_at DESC LIMIT 1`);
  const [review] = await ids(sql`SELECT id FROM tracks WHERE status = 'in_review' ORDER BY created_at DESC LIMIT 1`);
  const urls = [
    ...AREAS.map((a) => a.href),
    '/admin/catalog/pricing',
    '/admin/catalog/taxonomy',
    ...(dispute ? [`/admin/disputes/${dispute}`] : []),
    ...(batch ? [`/admin/payouts/${batch}`] : []),
    ...(review ? [`/admin/verification/${review}`] : []),
  ];
  for (const url of urls) await expectAccessible(page, url, url);
});
