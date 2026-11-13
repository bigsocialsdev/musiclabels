import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { listOwnTracks } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { requireSellerSession } from '../session';
import { Page, PageHeader } from '../ui';
import { STATUS_LABELS, statusTone } from './status';

export const dynamic = 'force-dynamic';

export default async function SellerTracksPage() {
  const { session, orgId } = await requireSellerSession('/seller/tracks');
  if (!orgId) redirect('/seller/onboarding');
  const rows = await listOwnTracks(getDb(), { userId: session.userId, orgId });
  return (
    <Page width="wide">
      <PageHeader
        title="Your tracks"
        aside={
          <Link href="/seller/tracks/new" className={buttonVariants()}>
            Add a track
          </Link>
        }
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tracks yet. Add one to get started.</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border bg-card">
          {rows.map((t) => (
            <li key={t.id} className="border-b last:border-b-0">
              <Link href={`/seller/tracks/${t.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-background">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{t.title}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{t.primaryArtist}</span>
                </span>
                <StatusLabel tone={statusTone(t.status)}>{STATUS_LABELS[t.status]}</StatusLabel>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
