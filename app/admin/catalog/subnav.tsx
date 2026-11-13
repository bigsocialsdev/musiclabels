import Link from 'next/link';

const LINKS = [
  { key: 'tracks', href: '/admin/catalog', label: 'Tracks' },
  { key: 'taxonomy', href: '/admin/catalog/taxonomy', label: 'Genres and moods' },
  { key: 'pricing', href: '/admin/catalog/pricing', label: 'Price books' },
] as const;

/** Sub-navigation for the catalog area: tracks, taxonomy and price books share one tab in the console bar. */
export function CatalogNav({ current }: { current: (typeof LINKS)[number]['key'] }) {
  return (
    <nav aria-label="Catalog" className="flex gap-4 text-[13px] font-semibold">
      {LINKS.map((l) => (
        <Link key={l.key} href={l.href} aria-current={l.key === current ? 'page' : undefined} className="text-muted-foreground underline-offset-4 hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
