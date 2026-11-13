import Link from 'next/link';
import type { ReactNode } from 'react';

export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav aria-label="Seller" className="border-b">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-sm">
          <Link href="/seller/onboarding" className="underline-offset-4 hover:underline">
            Onboarding
          </Link>
          <Link href="/seller/tracks" className="underline-offset-4 hover:underline">
            Tracks
          </Link>
          <Link href="/seller/sales" className="underline-offset-4 hover:underline">
            Sales
          </Link>
          <Link href="/seller/payouts" className="underline-offset-4 hover:underline">
            Payouts
          </Link>
          <Link href="/seller/clearance" className="underline-offset-4 hover:underline">
            Clearance
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}
