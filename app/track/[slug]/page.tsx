import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublishedTrack } from '@/lib/catalog/server';
import { TIER_LABELS } from '@/lib/certificates';
import { formatInr } from '@/lib/invoicing';
import { TIERS, quoteLicense } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';

export const dynamic = 'force-dynamic';

/** Bare track page (S3-M4): tiers available for this track with their pre-GST price. Discovery UI is S4-M8. */
export default async function TrackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const track = await getPublishedTrack(db, { slug });
  if (!track) notFound();
  const quotes = await Promise.all(TIERS.map(async (tier) => ({ tier, quote: await quoteLicense(db, track.id, tier) })));
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">{track.title}</h1>
      <p className="text-gray-600">{track.primaryArtist}</p>
      <h2 className="mt-6 font-semibold">License options</h2>
      <ul className="mt-2 space-y-2">
        {quotes.map(({ tier, quote }) => (
          <li key={tier} className="flex items-center justify-between border-b py-2">
            <span>{TIER_LABELS[tier]}</span>
            {quote.ok ? (
              <Link className="underline" href={`/checkout/${track.id}?tier=${tier}`}>
                {formatInr(quote.value.amountPaise)} + GST — buy
              </Link>
            ) : (
              <span className="text-sm text-gray-500">Not available for this track</span>
            )}
          </li>
        ))}
        <li className="flex items-center justify-between py-2">
          <span>Commercial / Broadcast</span>
          <span className="text-sm text-gray-500">By enquiry</span>
        </li>
      </ul>
      <p className="mt-6 text-sm text-gray-600">Clearance is a process, not a guarantee. See the license text before you buy.</p>
    </main>
  );
}
