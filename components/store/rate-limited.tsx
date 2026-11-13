import { headers } from 'next/headers';
import type { DbOrTx } from '@/lib/platform/db';
import { allowByIp, LIMITS } from '@/lib/platform/ratelimit';

/** True when this address has used up its storefront allowance (browse, search, track and enquiry pages). */
export async function storefrontLimited(db: DbOrTx): Promise<boolean> {
  return !(await allowByIp('storefront', await headers(), LIMITS.storefront, db));
}

/** Shown in place of a public page when its address has used up its allowance (a server component cannot set a 429). */
export function RateLimited() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <meta name="robots" content="noindex" />
      <h1 className="text-title">Too many requests</h1>
      <p role="alert" className="mt-2 text-sm text-muted-foreground">
        You have made a lot of requests in a short time. Wait a minute, then try again.
      </p>
    </main>
  );
}
