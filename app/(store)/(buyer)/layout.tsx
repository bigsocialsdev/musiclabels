import type { ReactNode } from 'react';
import { BuyerNav } from './buyer-nav';

/** Buyer pages share the storefront's night theme; this adds the account tabs under the top bar. */
export default function BuyerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="border-b">
        <BuyerNav />
      </div>
      {children}
    </>
  );
}
