import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { checkoutSignature } from './fake-razorpay';
import { signIn } from './fake-supabase';
import { E2E_BUYER, E2E_SELLER, E2E_TRACK_TITLE } from './fixtures';

// PLAN S3-M4 golden path: browse, license, pay, certificate, verify. Razorpay Checkout and the Razorpay API are the
// stand-ins in fake-razorpay.ts; everything else is the app: order, callback verification, markPaid, fulfilment,
// invoice, license, PDFs (stored in the fake Storage), the buyer's license page and the public verify page. Payment
// arrives by the client callback, the path a buyer's browser takes; the webhook route is covered by the Vitest suite.
// Needs `npm run seed:e2e` (a published track and a buyer organisation with the names in fixtures.ts) and the same
// RAZORPAY_KEY_SECRET the app runs with.
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const FAKE_CHECKOUT = `window.Razorpay = function (o) {
  this.open = async function () {
    const id = 'pay_' + o.order_id;
    o.handler({ razorpay_payment_id: id, razorpay_order_id: o.order_id, razorpay_signature: await window.e2eSign(o.order_id, id) });
  };
};`;
const PUBLIC_ID = /LIC-(?:[0-9A-Z]{5}-){4}[0-9A-Z]{6}/;

test('a buyer licenses a track and the public verify page shows it', async ({ page, context }) => {
  expect(KEY_SECRET, 'RAZORPAY_KEY_SECRET must be set to the secret the app runs with').toBeTruthy();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [track] = await sql<{ slug: string }[]>`
    SELECT t.slug FROM tracks t JOIN organizations o ON o.id = t.seller_org_id
    WHERE o.legal_name = ${E2E_SELLER} AND t.status = 'published' ORDER BY t.created_at DESC LIMIT 1`;
  const [buyer] = await sql<{ userId: string; email: string }[]>`
    SELECT u.id AS "userId", u.email FROM organizations o JOIN memberships m ON m.org_id = o.id AND m.role = 'owner' JOIN users u ON u.id = m.user_id
    WHERE o.legal_name = ${E2E_BUYER} ORDER BY o.created_at DESC LIMIT 1`;
  await sql.end();
  expect(track && buyer, 'run `npm run seed:e2e` first').toBeTruthy();

  await signIn(context, buyer!);
  await page.exposeFunction('e2eSign', (orderId: string, paymentId: string) => checkoutSignature(KEY_SECRET!, orderId, paymentId));
  await context.route('https://checkout.razorpay.com/**', (route) => route.fulfill({ contentType: 'text/javascript', body: FAKE_CHECKOUT }));

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto(`/track/${track!.slug}`);
  await page.locator('a[href^="/checkout/"]').first().click();

  await page.getByLabel('Channel 1 handle or URL').fill('https://www.youtube.com/@e2e-channel');
  await page.getByLabel('Billing state').selectOption({ label: 'Maharashtra' });
  await page.getByRole('checkbox', { name: /read the license text/ }).check();
  await page.getByRole('button', { name: 'Pay with Razorpay' }).click();

  // The order page refreshes itself while fulfilment runs, then sends the buyer to the license.
  await page.waitForURL(/\/licenses\/[0-9a-f-]+$/, { timeout: 90_000 });
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  const publicId = (await page.locator('body').innerText()).match(PUBLIC_ID)?.[0];
  expect(publicId, 'the license page shows the public id').toBeTruthy();

  // Certificate and invoice are real PDFs from the fake Storage.
  for (const [name, doc] of [['Certificate', 'certificate'], ['Tax invoice', 'invoice']]) {
    const href = await page.locator(`a[href$="/documents/${doc}"]`).getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.ok(), `${name} download`).toBe(true);
    expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
  }

  await context.clearCookies();
  await page.goto(`/verify/${publicId}`);
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(E2E_TRACK_TITLE)).toBeVisible();
});
