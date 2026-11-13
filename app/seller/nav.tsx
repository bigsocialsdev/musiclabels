'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/seller/onboarding', 'Onboarding'],
  ['/seller/tracks', 'Tracks'],
  ['/seller/sales', 'Sales'],
  ['/seller/payouts', 'Payouts'],
  ['/seller/clearance', 'Clearance'],
] as const;

export function SellerNav() {
  const path = usePathname();
  return (
    <nav aria-label="Seller" className="flex h-full gap-0.5 overflow-x-auto">
      {LINKS.map(([href, label]) => {
        const current = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className="-mb-px flex items-center border-b-2 border-transparent px-2.5 text-[13px] font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
