import Link from 'next/link';
import { listReviewQueue } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { requireVerificationAdmin } from './guard';

export const dynamic = 'force-dynamic';

export default async function VerificationQueue({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await requireVerificationAdmin('/admin/verification');
  const { done } = await searchParams;
  const rows = await listReviewQueue(getDb());
  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-xl font-semibold">Verification queue</h1>
      {done && <p role="status" className="mt-2 text-green-700">Track {done}.</p>}
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">Nothing waiting for review.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1">Track</th>
              <th>Seller</th>
              <th>Screening</th>
              <th>Probes</th>
              <th>Waiting since</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.trackId} className="border-b">
                <td className="py-1">
                  <Link className="underline" href={`/admin/verification/${r.trackId}`}>
                    {r.title}
                  </Link>{' '}
                  <span className="text-gray-600">{r.primaryArtist}</span>
                </td>
                <td>{r.sellerName}</td>
                <td>{r.screeningStatus ?? 'pending'}</td>
                <td>{r.probeCount}</td>
                <td>{r.submittedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
