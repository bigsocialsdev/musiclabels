/** Seller onboarding signs a visitor in first (requireSellerSession), then offers "Become a seller" if they have no seller org. */
export const SELL_HREF = '/seller/onboarding';

export type AccountLink = { href: string; label: string };

/** Buyer and seller are orgs a user belongs to, not account types: one login can hold both. */
export function accountLinks(orgs: { buyer: boolean; seller: boolean }): AccountLink[] {
  return [
    ...(orgs.buyer ? [{ href: '/licenses', label: 'My licenses' }] : []),
    orgs.seller ? { href: '/seller', label: 'Seller dashboard' } : { href: SELL_HREF, label: 'Sell your music' },
  ];
}

/** Where Sign in returns to: the current page, except the auth pages themselves. */
export function signInHref(pathname: string): string {
  if (pathname === '/' || pathname.startsWith('/auth/')) return '/auth/sign-in';
  return `/auth/sign-in?${new URLSearchParams({ next: pathname })}`;
}
