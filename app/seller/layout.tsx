import Link from 'next/link';
import type { ReactNode } from 'react';

export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <nav aria-label="Seller" className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-3 text-sm">
          <Link href="/seller/onboarding" className="underline-offset-4 hover:underline">
            Onboarding
          </Link>
          <Link href="/seller/tracks" className="underline-offset-4 hover:underline">
            Tracks
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}
