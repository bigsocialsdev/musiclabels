import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { signIn } from './fake-supabase';
import { E2E_BUYER, E2E_SELLER } from './fixtures';

// Storefront top bar: Sign in when signed out, an account menu that follows the user's orgs when signed in, and a path to
// seller onboarding from anywhere. Needs `npm run seed:e2e`.
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
test.afterAll(() => sql.end());

const ownerOf = async (legalName: string) =>
  (
    await sql<{ userId: string; email: string }[]>`
      SELECT u.id AS "userId", u.email FROM organizations o JOIN memberships m ON m.org_id = o.id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
      WHERE o.legal_name = ${legalName} ORDER BY o.created_at DESC LIMIT 1`
  )[0];

test('a signed-out visitor sees Sign in and can reach seller onboarding through sign-in', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible();
  // The top-bar link is desktop only; the footer link is on every screen.
  await page.getByRole('contentinfo').getByRole('link', { name: /Sell your music/ }).click();
  await page.waitForURL(/\/auth\/sign-in\?next=%2Fseller%2Fonboarding$/);
  await expect(page.getByText(/start selling/)).toBeVisible();
  if (!isMobile) {
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('link', { name: 'Sell your music' })).toBeVisible();
  }
});

test('a buyer gets licenses and the way to start selling, then signs out', async ({ page, context }) => {
  const buyer = await ownerOf(E2E_BUYER);
  expect(buyer, 'run `npm run seed:e2e` first').toBeTruthy();
  await signIn(context, buyer!);
  await page.goto('/');
  await page.getByRole('button', { name: `Account: ${buyer!.email}` }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'My licenses' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Sell your music' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Seller dashboard' })).toHaveCount(0);

  await menu.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
  expect((await context.cookies()).some((c) => c.name.endsWith('-auth-token')), 'session cookie cleared').toBe(false);
});

test('a seller gets the seller dashboard from the storefront', async ({ page, context }) => {
  const seller = await ownerOf(E2E_SELLER);
  expect(seller, 'run `npm run seed:e2e` first').toBeTruthy();
  await signIn(context, seller!);
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Sell your music' })).toHaveCount(0);
  await page.getByRole('button', { name: `Account: ${seller!.email}` }).click();
  await page.getByRole('menuitem', { name: 'Seller dashboard' }).click();
  await page.waitForURL(/\/seller\//);
});
