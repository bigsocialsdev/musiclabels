import type { Metadata } from 'next';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { docActionClass } from '@/components/store/doc-row';
import { istDate, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { TRACK_STATUSES, listAdminTracks, type TrackStatus } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { availabilityAction, reclassifyAction } from './actions';
import { CatalogNav } from './subnav';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Catalog | MRM Admin', robots: { index: false } };

const STATUS: Record<TrackStatus, { tone: StatusTone; label: string }> = {
  draft: { tone: 'muted', label: 'Draft' },
  submitted: { tone: 'info', label: 'Submitted' },
  in_review: { tone: 'info', label: 'In review' },
  published: { tone: 'ok', label: 'Published' },
  rejected: { tone: 'muted', label: 'Rejected' },
  suspended: { tone: 'attention', label: 'Suspended' },
  delisted: { tone: 'muted', label: 'Delisted' },
};
const DONE: Record<string, string> = {
  suspend: 'Track suspended. Existing licenses are untouched.',
  reinstate: 'Track back on sale.',
  delist: 'Track delisted. Existing licenses are untouched.',
  class_B: 'Reclassified to B.',
  class_C: 'Reclassified to C: the track is suspended and ops has been alerted to review its licenses.',
};
const ERRORS: Record<string, string> = {
  need_reason: 'Write a reason.',
  cannot_move: 'That change is not allowed from the track’s current status. A class C track is never reinstated.',
  not_found: 'Track not found.',
  not_live: 'Only published or suspended tracks can be reclassified.',
  not_allowed: 'That reclassification is not allowed. A → B, A → C and B → C only.',
  class_b_guard: 'Class B needs the seller’s accepted release commitment and an ops contact.',
  conflict: 'The track changed while you were working. Refresh and try again.',
};

const textarea = 'w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring';

/** Catalog admin (PLAN §9): find a track, suspend, reinstate or delist it, or move its clearance class. Existing licenses are never touched. */
export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; done?: string; error?: string }> }) {
  const admin = await requireAdminArea('verification', '/admin/catalog');
  const { q, status, done, error } = await searchParams;
  const filter = TRACK_STATUSES.find((s) => s === status);
  const rows = await listAdminTracks(getDb(), admin, { q, status: filter });

  return (
    <Page width="wide">
      <PageHeader title="Catalog">Suspending or delisting a track takes it off sale; licenses already issued stay valid.</PageHeader>
      <CatalogNav current="tracks" />
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
      <form className="flex flex-wrap items-end gap-2" action="/admin/catalog">
        <div className="grid gap-1">
          <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="q">
            Title or artist
          </label>
          <input id="q" name="q" defaultValue={q ?? ''} maxLength={100} className="h-9 w-56 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring" />
        </div>
        <div className="grid gap-1">
          <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={filter ?? ''} className="h-9 w-40 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring">
            <option value="">All</option>
            {TRACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tracks match.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Track</Th>
              <Th>Status</Th>
              <Th>Class</Th>
              <Th>Updated</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const s = STATUS[t.status as TrackStatus];
              const live = t.status === 'published' || t.status === 'suspended';
              const moves = t.clearanceClass === 'A' ? (['B', 'C'] as const) : t.clearanceClass === 'B' ? (['C'] as const) : ([] as const);
              return (
                <tr key={t.id} className="align-top">
                  <Td>
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-[13px] text-muted-foreground">
                      {t.primaryArtist} · {t.sellerName}
                    </div>
                  </Td>
                  <Td>
                    <StatusLabel tone={s.tone}>{s.label}</StatusLabel>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {t.clearanceClass ?? 'None'}
                    {t.priceLevel && <span className="text-fg-2"> · {t.priceLevel}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-fg-2">{istDate(t.updatedAt)}</Td>
                  <Td>
                    <div className="grid gap-2">
                      {live && (
                        <details className="text-[13px]">
                          <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">Change availability</summary>
                          <form action={availabilityAction.bind(null, t.id)} className="mt-2 grid gap-2">
                            <select name="action" className={selectClass} defaultValue={t.status === 'published' ? 'suspend' : 'reinstate'}>
                              {t.status === 'published' && <option value="suspend">Suspend</option>}
                              {t.status === 'suspended' && t.clearanceClass !== 'C' && <option value="reinstate">Reinstate</option>}
                              <option value="delist">Delist</option>
                            </select>
                            <textarea name="reason" required maxLength={1000} rows={2} placeholder="Reason" aria-label={`Reason for ${t.title}`} className={textarea} />
                            <div>
                              <button className={docActionClass}>Apply</button>
                            </div>
                          </form>
                        </details>
                      )}
                      {live && moves.length > 0 && (
                        <details className="text-[13px]">
                          <summary className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground">Reclassify</summary>
                          <form action={reclassifyAction.bind(null, t.id)} className="mt-2 grid gap-2">
                            <select name="to" className={selectClass} defaultValue={moves[0]}>
                              {moves.map((c) => (
                                <option key={c} value={c}>
                                  {c === 'C' ? 'C: no release path (suspends the track)' : 'B: seller controls the release'}
                                </option>
                              ))}
                            </select>
                            <textarea name="reason" required maxLength={1000} rows={2} placeholder="Reason" aria-label={`Reclassification reason for ${t.title}`} className={textarea} />
                            <div>
                              <button className={docActionClass}>Reclassify</button>
                            </div>
                          </form>
                        </details>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
