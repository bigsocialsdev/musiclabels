import Link from 'next/link';
import { listBuyerOrgs, listSellerOrgs, loadSession } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';
import { AccountDropdown, SignInLink } from './account-dropdown';
import { SELL_HREF, accountLinks } from './account-links';

const sellLink = (
  <Link href={SELL_HREF} className="rounded-sm px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground max-[900px]:hidden">
    Sell your music
  </Link>
);

/**
 * Storefront top-bar identity. An unverified session (OTP not yet confirmed) counts as signed out, as every gated page
 * treats it. Org lookups are keyed by the session's own user id, never by client input.
 */
export async function AccountMenu() {
  const session = await loadSession();
  if (!session?.verified) {
    return (
      <>
        {sellLink}
        <SignInLink />
      </>
    );
  }
  const db = getDb();
  const [buyer, seller] = await Promise.all([listBuyerOrgs(db, session.userId), listSellerOrgs(db, session.userId)]);
  const orgs = { buyer: buyer.length > 0, seller: seller.length > 0 };
  return (
    <>
      {!orgs.seller && sellLink}
      <AccountDropdown identity={session.email ?? session.phone ?? 'Your account'} links={accountLinks(orgs)} />
    </>
  );
}
