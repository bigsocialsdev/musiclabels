import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { AREAS } from '../../app/admin/areas';
import { expectAccessible } from './axe';
import { signIn } from './fake-auth';

// Signed-in pages, against the database's existing data (run `npm test` or seed first) and a fake Auth server.
// A missing row fails the test rather than skipping it, so an empty database cannot pass as a clean one.
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const adminIds: string[] = [];
test.afterAll(async () => {
  if (adminIds.length) await sql`DELETE FROM users WHERE id IN ${sql(adminIds)}`;
  await sql.end();
});

type Who = { userId: string; email: string };
const firstId = async (query: Promise<{ id: string }[]>) => (await query)[0]?.id;

test('buyer pages are accessible', async ({ page, context }) => {
  const [row] = await sql<(Who & { id: string; trackId: string })[]>`
    SELECT l.id, l.track_id AS "trackId", u.id AS "userId", u.email FROM licenses l
    JOIN memberships m ON m.org_id = l.purchaser_org_id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
    ORDER BY l.starts_at DESC LIMIT 1`;
  expect(row, 'needs a license in the database').toBeTruthy();
  await signIn(context, row!);
  for (const url of ['/account', '/licenses', '/invoices', `/licenses/${row!.id}`, `/licenses/${row!.id}/disputes`, `/checkout/${row!.trackId}`])
    await expectAccessible(page, url);
});

test('seller pages are accessible', async ({ page, context }) => {
  const [row] = await sql<(Who & { id: string })[]>`
    SELECT t.id, u.id AS "userId", u.email FROM tracks t
    JOIN memberships m ON m.org_id = t.seller_org_id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
    JOIN seller_profiles p ON p.org_id = t.seller_org_id AND p.kyc_status = 'verified'
    WHERE t.status = 'published' ORDER BY t.created_at DESC LIMIT 1`;
  expect(row, 'needs a verified seller with a published track in the database').toBeTruthy();
  await signIn(context, row!);
  for (const url of ['/seller/onboarding', '/seller/tracks', '/seller/tracks/new', `/seller/tracks/${row!.id}`, '/seller/sales', '/seller/payouts', '/seller/clearance'])
    await expectAccessible(page, url);
});

test('admin pages are accessible', async ({ page, context }) => {
  const id = randomUUID();
  const email = `e2e-admin-${id}@example.com`;
  adminIds.push(id);
  await sql`INSERT INTO users (id, email, verified_at, platform_role, admin_permissions) VALUES (${id}, ${email}, now(), 'admin', ARRAY['superadmin'])`;
  await signIn(context, { userId: id, email, aal: 'aal2' });
  // Detail pages need a row to open; the list pages above them always render.
  const dispute = await firstId(sql`SELECT id FROM disputes ORDER BY created_at DESC LIMIT 1`);
  const batch = await firstId(sql`SELECT id FROM payout_batches ORDER BY created_at DESC LIMIT 1`);
  const review = await firstId(sql`SELECT id FROM tracks WHERE status = 'in_review' ORDER BY created_at DESC LIMIT 1`);
  const urls = [
    ...AREAS.map((a) => a.href),
    '/admin/catalog/pricing',
    '/admin/catalog/taxonomy',
    ...(dispute ? [`/admin/disputes/${dispute}`] : []),
    ...(batch ? [`/admin/payouts/${batch}`] : []),
    ...(review ? [`/admin/verification/${review}`] : []),
  ];
  for (const url of urls) await expectAccessible(page, url);
});
