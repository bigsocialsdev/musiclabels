import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { signIn } from './fake-supabase';
import { E2E_BUYER } from './fixtures';

// First-visit band on the home page: shown to a new signed-out visitor, gone for good once dismissed, never on filtered
// views or for a signed-in user. Needs `npm run seed:e2e`.
const intro = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Music for your videos, licensed properly.' });

test('a first-time visitor sees the band once, and dismissing it sticks', async ({ page }) => {
  await page.goto('/');
  await expect(intro(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(intro(page).getByRole('link', { name: 'Sell your music' })).toHaveAttribute('href', '/seller/onboarding');

  await page.getByRole('button', { name: 'Dismiss introduction' }).click();
  await expect(intro(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(intro(page)).toHaveCount(0);
});

test('filtered views and signed-in users go straight to the browse grid', async ({ page, context }) => {
  await page.goto('/?q=a');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(intro(page)).toHaveCount(0);

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [buyer] = await sql<{ userId: string; email: string }[]>`
    SELECT u.id AS "userId", u.email FROM organizations o JOIN memberships m ON m.org_id = o.id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
    WHERE o.legal_name = ${E2E_BUYER} ORDER BY o.created_at DESC LIMIT 1`;
  await sql.end();
  expect(buyer, 'run `npm run seed:e2e` first').toBeTruthy();
  await signIn(context, buyer!);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(intro(page)).toHaveCount(0);
});
