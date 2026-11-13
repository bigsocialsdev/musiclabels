import Link from 'next/link';
import type { ReactNode } from 'react';
import { TIER_LABELS } from '@/lib/certificates';
import type { DiscoveryFacets, DiscoverySearch, DiscoveryTier, FacetOption } from '@/lib/catalog';
import { cn } from '@/lib/utils';
import { BpmRange } from './bpm-range';
import { searchHref, toggled, withParams } from './search-params';

export const LANGUAGE_LABELS: Record<string, string> = { hindi: 'Hindi', punjabi: 'Punjabi', tamil: 'Tamil', english: 'English', instrumental: 'Instrumental' };

const LENGTHS = [
  { label: 'Under 1:00', min: undefined, max: 60 },
  { label: '1:00 to 2:00', min: 60, max: 120 },
  { label: '2:00 to 3:00', min: 120, max: 180 },
  { label: '3:00 and longer', min: 180, max: undefined },
] as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

/** One filter option as a plain link: the URL is the state, so it works without scripts and can be shared. */
function Opt({ href, selected, children, count }: { href: string; selected: boolean; children: ReactNode; count?: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? 'true' : undefined}
      className={cn('flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left text-sm font-medium text-fg-2 hover:bg-secondary hover:text-foreground', selected && 'bg-secondary font-semibold text-foreground')}
    >
      <span className="flex flex-1 items-center">
        {selected && <span aria-hidden className="mr-2 size-1.5 rounded-full bg-foreground" />}
        {children}
        {selected && <span className="sr-only"> (selected)</span>}
      </span>
      {count !== undefined && <span className="font-mono text-xs font-normal text-muted-foreground">{count}</span>}
    </Link>
  );
}

const shown = (options: FacetOption[], selected: string[]) => options.filter((o) => o.count > 0 || selected.includes(o.value));

/** Every facet of the filter rail. Zero-count options are hidden unless picked, so there is no dead end to click into. */
export function FilterGroups({ search, facets, priceLabels }: { search: DiscoverySearch; facets: DiscoveryFacets; priceLabels: Record<string, string> }) {
  const baseNoBpm = searchHref({ ...search, bpmMin: undefined, bpmMax: undefined, page: 1 });
  return (
    <>
      {shown(facets.moods, search.mood).length > 0 && (
        <Group title="Mood">
          {shown(facets.moods, search.mood).map((o) => (
            <Opt key={o.value} href={toggled(search, 'mood', o.value)} selected={search.mood.includes(o.value)} count={o.count}>
              {o.label}
            </Opt>
          ))}
        </Group>
      )}
      <Group title="Language">
        {shown(facets.languages, search.lang).map((o) => (
          <Opt key={o.value} href={toggled(search, 'lang', o.value)} selected={(search.lang as string[]).includes(o.value)} count={o.count}>
            {LANGUAGE_LABELS[o.value]}
          </Opt>
        ))}
      </Group>
      {shown(facets.genres, search.genre).length > 0 && (
        <Group title="Genre">
          {shown(facets.genres, search.genre).map((o) => (
            <Opt key={o.value} href={toggled(search, 'genre', o.value)} selected={search.genre.includes(o.value)} count={o.count}>
              {o.label}
            </Opt>
          ))}
        </Group>
      )}
      {facets.bpm && (
        <Group title="Tempo">
          <BpmRange key={`${search.bpmMin}-${search.bpmMax}`} bounds={facets.bpm} value={{ min: search.bpmMin, max: search.bpmMax }} baseHref={baseNoBpm} />
        </Group>
      )}
      <Group title="Length">
        {LENGTHS.map((l) => {
          const on = search.durMin === l.min && search.durMax === l.max;
          return (
            <Opt key={l.label} href={withParams(search, on ? { durMin: undefined, durMax: undefined } : { durMin: l.min, durMax: l.max })} selected={on}>
              {l.label}
            </Opt>
          );
        })}
      </Group>
      {shown(facets.priceLevels, search.price).length > 0 && (
        <Group title="Creator license price">
          {shown(facets.priceLevels, search.price).map((o) => (
            <Opt key={o.value} href={toggled(search, 'price', o.value)} selected={(search.price as string[]).includes(o.value)} count={o.count}>
              {priceLabels[o.value] ?? o.value}
            </Opt>
          ))}
        </Group>
      )}
      <Group title="License available">
        {shown(facets.tiers, search.tier).map((o) => (
          <Opt key={o.value} href={toggled(search, 'tier', o.value)} selected={search.tier.includes(o.value as DiscoveryTier)} count={o.count}>
            {TIER_LABELS[o.value as DiscoveryTier]}
          </Opt>
        ))}
      </Group>
    </>
  );
}

/** The mobile chip row: what is picked first (tap to remove), then the moods and languages that exist. */
export function Chips({ search, facets }: { search: DiscoverySearch; facets: DiscoveryFacets }) {
  const label = (key: 'mood' | 'lang' | 'genre', value: string) =>
    key === 'lang' ? LANGUAGE_LABELS[value] : (key === 'mood' ? facets.moods : facets.genres).find((o) => o.value === value)?.label ?? value;
  const picked = (['mood', 'lang', 'genre'] as const).flatMap((k) => search[k].map((v) => ({ k, v })));
  const rest = [
    ...facets.moods.filter((o) => o.count > 0 && !search.mood.includes(o.value)).map((o) => ({ k: 'mood' as const, v: o.value })),
    ...facets.languages.filter((o) => o.count > 0 && !(search.lang as string[]).includes(o.value)).map((o) => ({ k: 'lang' as const, v: o.value })),
  ];
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] min-[901px]:hidden">
      {[...picked.map((c) => ({ ...c, on: true })), ...rest.map((c) => ({ ...c, on: false }))].map(({ k, v, on }) => (
        <Link
          key={`${k}-${v}`}
          href={toggled(search, k, v)}
          scroll={false}
          aria-current={on ? 'true' : undefined}
          className={cn('flex h-[34px] flex-none items-center rounded-md border bg-card px-3 text-[13px] font-semibold text-fg-2', on && 'border-foreground bg-foreground text-background')}
        >
          {label(k, v)}
        </Link>
      ))}
    </div>
  );
}
