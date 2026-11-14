'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type ConsoleIcon } from './icons';

export type ConsoleNavItem = { href: string; label: string; icon: ConsoleIcon };

/** Sidebar links on wide screens, a scrolling tab row on phones; the current section is marked with aria-current. */
export function ConsoleNav({ items, label, variant }: { items: readonly ConsoleNavItem[]; label: string; variant: 'side' | 'bar' }) {
  const path = usePathname();
  const current = (href: string) => path === href || path.startsWith(`${href}/`);
  if (variant === 'bar')
    return (
      <nav aria-label={label} className="flex gap-0.5 overflow-x-auto px-3 [scrollbar-width:none]">
        {items.map(({ href, label: text }) => (
          <Link
            key={href}
            href={href}
            aria-current={current(href) ? 'page' : undefined}
            className="-mb-px flex h-10 items-center border-b-2 border-transparent px-2.5 text-[13px] font-semibold whitespace-nowrap text-muted-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground"
          >
            {text}
          </Link>
        ))}
      </nav>
    );
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5">
      {items.map(({ href, label: text, icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={current(href) ? 'page' : undefined}
          className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-2 transition-colors hover:bg-nav-active hover:text-foreground aria-[current=page]:bg-nav-active aria-[current=page]:font-semibold aria-[current=page]:text-foreground [&>svg]:text-muted-foreground aria-[current=page]:[&>svg]:text-foreground"
        >
          <Icon name={icon} />
          {text}
        </Link>
      ))}
    </nav>
  );
}
