import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { listOwnTracks } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { requireSellerSession } from '../session';
import { STATUS_LABELS, statusVariant } from './status';

export const dynamic = 'force-dynamic';

export default async function SellerTracksPage() {
  const { session, orgId } = await requireSellerSession('/seller/tracks');
  if (!orgId) redirect('/seller/onboarding');
  const rows = await listOwnTracks(getDb(), { userId: session.userId, orgId });
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Your tracks</h1>
        <Link href="/seller/tracks/new" className={buttonVariants()}>
          Add a track
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tracks yet. Add one to get started.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/seller/tracks/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 hover:bg-muted/50">
                <span>
                  <span className="font-medium">{t.title}</span> <span className="text-sm text-muted-foreground">{t.primaryArtist}</span>
                </span>
                <Badge variant={statusVariant(t.status)}>{STATUS_LABELS[t.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
