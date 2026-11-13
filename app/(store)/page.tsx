import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { LANGUAGE_LABELS } from '@/lib/catalog';
import { facetCounts, searchTracks } from '@/lib/catalog/server';
import { formatInr } from '@/lib/invoicing';
import { getActivePriceGrid } from '@/lib/pricing/server';
import { RateLimited } from '@/components/store/rate-limited';
import { getDb } from '@/lib/platform/db';
import { allowByIp, LIMITS } from '@/lib/platform/ratelimit';
import { Discovery } from './discovery';
import { Chips, FilterGroups } from './rail';
import { parseSearch, searchHref, withParams } from './search-params';
import { SearchBox } from './search-box';
import { SortSelect } from './sort-select';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const filtered = (s: ReturnType<typeof parseSearch>) => Boolean(s.q || s.genre.length || s.mood.length || s.lang.length || s.price.length || s.tier.length || s.bpmMin || s.bpmMax || s.durMin !== undefined || s.durMax !== undefined || s.page > 1 || s.sort !== 'relevance');

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const s = parseSearch(await searchParams);
  return {
    title: s.q ? `“${s.q}”: tracks to license | MRM` : 'Browse tracks to license | MRM',
    description: 'Licensable music for creators and brands in India. Every track is screened before it is listed, and every license comes with a certificate and a GST invoice.',
    // Filtered and paged views are for people, not for the index.
    robots: filtered(s) ? { index: false, follow: true } : undefined,
  };
}

export default async function BrowsePage({ searchParams }: Props) {
  const search = parseSearch(await searchParams);
  const db = getDb();
  if (!(await allowByIp('storefront', await headers(), LIMITS.storefront, db))) return <RateLimited />;
  const [result, facets, grid] = await Promise.all([searchTracks(db, search), facetCounts(db, search), getActivePriceGrid(db)]);
  const priceLabels = Object.fromEntries(grid.filter((g) => g.tier === 'creator').map((g) => [g.priceLevel, formatInr(g.amountPaise)]));

  const names = [...search.mood.map((id) => facets.moods.find((o) => o.value === id)?.label), ...search.genre.map((id) => facets.genres.find((o) => o.value === id)?.label)].filter(Boolean);
  const langs = search.lang.map((l) => LANGUAGE_LABELS[l]);
  const title = search.q ? `Results for “${search.q}”` : names.length || langs.length ? [names.join(', '), langs.length ? `${names.length ? 'in ' : 'In '}${langs.join(' or ')}` : ''].filter(Boolean).join(', ') : 'Browse tracks';
  const sorts = [
    { value: 'relevance', label: 'Most relevant' },
    { value: 'licensed', label: 'Most licensed' },
    { value: 'newest', label: 'Newest' },
  ].map((o) => ({ ...o, href: withParams(search, { sort: o.value as typeof search.sort }) }));

  const header = (
    <div className="mb-2.5 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-headline max-[900px]:text-xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground max-[900px]:text-[13px]">
          {result.total} {result.total === 1 ? 'track' : 'tracks'} · every track is screened before listing
        </p>
      </div>
      <SortSelect value={search.sort} options={sorts} />
    </div>
  );

  const footer =
    result.pages > 1 ? (
      <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
        {search.page > 1 ? (
          <Link href={searchHref({ ...search, page: search.page - 1 })} rel="prev" className="rounded-sm px-3 py-2 font-semibold hover:bg-secondary">
            Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="font-mono text-[13px] font-normal text-muted-foreground">
          {search.page} of {result.pages}
        </span>
        {search.page < result.pages ? (
          <Link href={searchHref({ ...search, page: search.page + 1 })} rel="next" className="rounded-sm px-3 py-2 font-semibold hover:bg-secondary">
            Next
          </Link>
        ) : (
          <span />
        )}
      </nav>
    ) : null;

  return (
    <Discovery
      key={searchHref(search)}
      tracks={result.tracks}
      rail={<FilterGroups search={search} facets={facets} priceLabels={priceLabels} />}
      chips={
        <>
          <SearchBox defaultValue={search.q} />
          <Chips search={search} facets={facets} />
          <details className="rounded-md border bg-card">
            <summary className="cursor-pointer px-3.5 py-2.5 text-[13px] font-semibold text-fg-2">More filters</summary>
            <div className="flex flex-col gap-5 px-2 pt-1 pb-4">
              <FilterGroups search={search} facets={facets} priceLabels={priceLabels} />
            </div>
          </details>
        </>
      }
      header={header}
      footer={footer}
    />
  );
}
