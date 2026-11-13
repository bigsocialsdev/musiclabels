import { redirect } from 'next/navigation';
import { listTaxonomy } from '@/lib/catalog/server';
import { getSellerStanding } from '@/lib/sellers/server';
import { FlashBanner } from '../../flash';
import { getDb } from '@/lib/platform/db';
import { requireSellerSession } from '../../session';
import { createTrackAction } from '../actions';
import { TrackForm } from '../track-form';

export const dynamic = 'force-dynamic';

export default async function NewTrackPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const { orgId } = await requireSellerSession('/seller/tracks/new');
  if (!orgId) redirect('/seller/onboarding');
  const db = getDb();
  if (!(await getSellerStanding(db, orgId))) redirect('/seller/onboarding'); // createTrack refuses without it; say so before the form is filled
  const taxonomy = await listTaxonomy(db);
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Add a track</h1>
      <p className="text-sm text-muted-foreground">Start with the details. You add the audio file and your rights documents on the next page.</p>
      <FlashBanner token={m} />
      <TrackForm action={createTrackAction} taxonomy={taxonomy} submitLabel="Create track" />
    </main>
  );
}
