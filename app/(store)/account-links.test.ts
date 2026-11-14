import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/identity';
import { accountLinks, signInHref } from './account-links';

describe('accountLinks', () => {
  it('offers selling to a user with no orgs yet', () => {
    expect(accountLinks({ buyer: false, seller: false })).toEqual([{ href: '/seller/onboarding', label: 'Sell your music' }]);
  });

  it('shows licenses for a buyer and the seller dashboard for a seller, together for a user in both', () => {
    expect(accountLinks({ buyer: true, seller: true })).toEqual([
      { href: '/licenses', label: 'My licenses' },
      { href: '/seller', label: 'Seller dashboard' },
    ]);
    expect(accountLinks({ buyer: true, seller: false }).map((l) => l.label)).toEqual(['My licenses', 'Sell your music']);
    expect(accountLinks({ buyer: false, seller: true }).map((l) => l.label)).toEqual(['Seller dashboard']);
  });
});

describe('signInHref', () => {
  it('returns to the current page, and that target survives safeNext', () => {
    const href = signInHref('/track/some-song');
    expect(href).toBe('/auth/sign-in?next=%2Ftrack%2Fsome-song');
    expect(safeNext(new URL(href, 'http://x').searchParams.get('next'))).toBe('/track/some-song');
  });

  it('does not loop back into the auth pages or add a next for the home page', () => {
    expect(signInHref('/auth/sign-in')).toBe('/auth/sign-in');
    expect(signInHref('/')).toBe('/auth/sign-in');
  });
});
