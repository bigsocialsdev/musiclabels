import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { expectAccessible } from './axe';

// Pages a visitor reaches without signing in. Signed-in pages: signed-in-a11y.spec.ts.
test('public pages are accessible', async ({ page }) => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const [track] = await sql<{ slug: string }[]>`SELECT slug FROM tracks WHERE status = 'published' ORDER BY created_at DESC LIMIT 1`;
  const [license] = await sql<{ public_id: string }[]>`SELECT public_id FROM licenses ORDER BY starts_at DESC LIMIT 1`;
  await sql.end();
  expect(track && license, 'needs a published track and a license in the database').toBeTruthy();
  const pages = {
    home: '/',
    'sign in': '/auth/sign-in',
    track: `/track/${track!.slug}`,
    enquiry: `/enquiry/${track!.slug}`,
    verify: `/verify/${license!.public_id}`,
  };
  for (const [name, url] of Object.entries(pages)) await expectAccessible(page, name, url);
});
