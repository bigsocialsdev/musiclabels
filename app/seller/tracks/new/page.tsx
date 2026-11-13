import { redirect } from 'next/navigation';
import { listTaxonomy } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { requireSellerSession } from '../../session';
import { createTrackAction } from '../actions';
import { TrackForm } from '../track-form';

export const dynamic = 'force-dynamic';

export default async function NewTrackPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { orgId } = await requireSellerSession('/seller/tracks/new');
  if (!orgId) redirect('/seller/onboarding');
  const taxonomy = await listTaxonomy(getDb());
  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Add a track</h1>
      <p className="text-sm text-muted-foreground">Start with the details. You add the audio file and your rights documents on the next page.</p>
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <TrackForm action={createTrackAction} taxonomy={taxonomy} submitLabel="Create track" />
    </main>
  );
}
