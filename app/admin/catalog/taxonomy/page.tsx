import type { Metadata } from 'next';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { docActionClass } from '@/components/store/doc-row';
import { own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { listTaxonomyAdmin } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../../guard';
import { createTaxonomyAction, toggleTaxonomyAction } from '../actions';
import { CatalogNav } from '../subnav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Genres and moods | MRM Admin', robots: { index: false } };

const DONE: Record<string, string> = { created: 'Added.', retired: 'Retired: sellers no longer see it in their pickers. Tracks that carry it keep it.', restored: 'Restored.' };
const ERRORS: Record<string, string> = { bad_name: 'Enter a name of 1 to 60 characters.', exists: 'That name already exists.', changed: 'That item already changed. Refresh and try again.' };

/** Genres and moods (PLAN §9: Catalog admin). Names are never edited or deleted: tracks reference them, so an item is retired instead. */
export default async function TaxonomyPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const admin = await requireAdminArea('verification', '/admin/catalog/taxonomy');
  const { done, error } = await searchParams;
  const { genres, moods } = await listTaxonomyAdmin(getDb(), admin);
  const groups = [
    { kind: 'genre' as const, title: 'Genres', items: genres },
    { kind: 'mood' as const, title: 'Moods', items: moods },
  ];

  return (
    <Page width="wide">
      <PageHeader title="Genres and moods">The lists sellers pick from when they describe a track.</PageHeader>
      <CatalogNav current="taxonomy" />
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
      <form action={createTaxonomyAction} className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="kind" className="text-[13px] font-semibold text-muted-foreground">
            Add a
          </label>
          <select id="kind" name="kind" className={`${selectClass} w-32`}>
            <option value="genre">Genre</option>
            <option value="mood">Mood</option>
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="name" className="text-[13px] font-semibold text-muted-foreground">
            Name
          </label>
          <input id="name" name="name" required maxLength={60} className="h-9 w-56 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring" />
        </div>
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>
      <div className="grid gap-6 md:grid-cols-2">
        {groups.map((g) => (
          <section key={g.kind} className="grid content-start gap-2">
            <h2 className="text-base font-semibold">{g.title}</h2>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {g.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className={i.active ? '' : 'text-muted-foreground line-through'}>{i.name}</span>
                  <form action={toggleTaxonomyAction.bind(null, g.kind, i.id, !i.active)}>
                    <button className={docActionClass}>{i.active ? 'Retire' : 'Restore'}</button>
                  </form>
                </li>
              ))}
              {g.items.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">None yet.</li>}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  );
}
