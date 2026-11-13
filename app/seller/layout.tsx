import type { ReactNode } from 'react';
import { SellerNav } from './nav';

export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-card">
        <div className="mx-auto flex h-13 max-w-5xl items-stretch gap-6 px-5">
          <span className="flex items-center gap-[7px] text-[17px] font-bold tracking-[-0.03em]">
            <span aria-hidden className="size-2 rounded-full bg-signal" />
            MRM <span className="text-[13px] font-semibold tracking-normal text-muted-foreground">Seller</span>
          </span>
          <SellerNav />
        </div>
      </header>
      {children}
    </>
  );
}
