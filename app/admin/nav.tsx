'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Area tabs (DESIGN.md console top bar): 13px/600, a 2px ink underline on the current area. */
export function AdminNav({ areas }: { areas: readonly { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Admin" className="flex h-full gap-0.5 overflow-x-auto">
      {areas.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={path === href || path.startsWith(`${href}/`) ? 'page' : undefined}
          className="-mb-px flex items-center border-b-2 border-transparent px-2.5 text-[13px] font-semibold whitespace-nowrap text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
