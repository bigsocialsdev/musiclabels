import type { Metadata } from 'next';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDate, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { PRICE_LEVELS } from '@/lib/catalog';
import { TIERS } from '@/lib/licensing';
import { listPriceBooks } from '@/lib/pricing/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../../guard';
import { activatePriceBookAction, createPriceBookAction } from '../actions';
import { priceField } from '../price-grid';
import { CatalogNav } from '../subnav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Price books | MRM Admin', robots: { index: false } };

const STATUS: Record<string, { tone: StatusTone; label: string }> = { draft: { tone: 'attention', label: 'Draft' }, active: { tone: 'ok', label: 'Active' }, retired: { tone: 'muted', label: 'Retired' } };
const TIER_LABEL: Record<string, string> = { creator: 'Creator', brand_organic: 'Brand organic', paid_ad: 'Paid ad' };
const DONE: Record<string, string> = { created: 'Draft price book created. Review it, then activate it.', activated: 'Price book activated. New orders use it; existing orders keep their snapshot.' };
const ERRORS: Record<string, string> = { bad_grid: 'Every level and tier needs a price in rupees, with at most two decimals.', not_draft: 'Only a draft price book can be activated.' };

const rupees = (paise: number) => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`; // integer arithmetic, no floats

/** Price books (PLAN §9: Catalog admin). A book prices every level × tier; a change is a new version, and activating it retires the old one. */
export default async function PricingPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdminArea('verification', '/admin/catalog/pricing');
  const { done, error } = await searchParams;
  const books = await listPriceBooks(getDb(), admin);
  const base = new Map((books[0]?.entries ?? []).map((e) => [priceField(e.priceLevel, e.tier), rupees(e.amountPaise)]));

  return (
    <Page width="wide">
      <PageHeader title="Price books">Prices are in rupees before GST. Orders store a snapshot of the price at creation, so activating a new book never changes an order already placed.</PageHeader>
      <CatalogNav current="pricing" />
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      {own(DONE, done) && (
        <Notice tone="ok" role="status">
          {own(DONE, done)}
        </Notice>
      )}

      <section className="grid gap-3">
        <h2 className="text-base font-semibold">New version</h2>
        <form action={createPriceBookAction} className="grid gap-3">
          <Table>
            <thead>
              <tr>
                <Th>Level</Th>
                {TIERS.map((t) => (
                  <Th key={t}>{own(TIER_LABEL, t) ?? t}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PRICE_LEVELS.map((level) => (
                <tr key={level}>
                  <Td className="font-semibold">{level}</Td>
                  {TIERS.map((tier) => (
                    <Td key={tier}>
                      <input
                        name={priceField(level, tier)}
                        required
                        inputMode="decimal"
                        pattern="[0-9]{1,9}(\.[0-9]{1,2})?"
                        defaultValue={base.get(priceField(level, tier)) ?? ''}
                        aria-label={`${level} ${own(TIER_LABEL, tier) ?? tier} price in rupees`}
                        className="h-9 w-32 rounded-md border border-input bg-card px-3 font-mono text-sm outline-none focus-visible:border-ring"
                      />
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          <div>
            <Button type="submit" variant="secondary">
              Create draft
            </Button>
          </div>
        </form>
      </section>

      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Versions</h2>
        {books.map((b) => {
          const s = own(STATUS, b.status) ?? { tone: 'muted' as StatusTone, label: b.status };
          return (
            <details key={b.id} open={b.status !== 'retired'} className="rounded-xl border border-border bg-card px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm font-semibold">
                Version {b.version}
                <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                <span className="font-normal text-fg-2">{b.effectiveAt ? `Effective ${istDate(b.effectiveAt)}` : `Created ${istDate(b.createdAt)}`}</span>
              </summary>
              <div className="mt-3 grid gap-3">
                <Table>
                  <thead>
                    <tr>
                      <Th>Level</Th>
                      {TIERS.map((t) => (
                        <Th key={t}>{own(TIER_LABEL, t) ?? t}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PRICE_LEVELS.map((level) => (
                      <tr key={level}>
                        <Td className="font-semibold">{level}</Td>
                        {TIERS.map((tier) => {
                          const e = b.entries.find((x) => x.priceLevel === level && x.tier === tier);
                          return (
                            <Td key={tier} className="font-mono">
                              {e ? rupees(e.amountPaise) : ''}
                            </Td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {b.status === 'draft' && (
                  <form action={activatePriceBookAction.bind(null, b.id)}>
                    <Button type="submit">Activate version {b.version}</Button>
                  </form>
                )}
              </div>
            </details>
          );
        })}
        {books.length === 0 && <p className="text-sm text-muted-foreground">No price book yet. Create the first one above.</p>}
      </section>
    </Page>
  );
}
