'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/licenses', 'Licenses'],
  ['/invoices', 'Invoices'],
  ['/account', 'Account'],
] as const;

export function BuyerNav() {
  const path = usePathname();
  return (
    <nav aria-label="Your account" className="mx-auto flex h-11 max-w-5xl gap-0.5 overflow-x-auto px-2.5">
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
