import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CLEARANCE_NOTICE, TIER_LABELS } from '@/lib/certificates';
import { verifyUrl } from '@/lib/certificates/server';
import { getLicenseForBuyer, resolveBuyerActor, type Tier } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { requireBuyerSession } from '../../buyer-session';
import { downloadAction } from '../actions';

export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  download_limit_reached: 'You have used all 20 downloads for this license. Contact support for more.',
  license_not_active: 'Downloads are disabled because this license is no longer active.',
  file_unavailable: 'That file is not available.',
};
const ist = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** Buyer license page (PLAN §5.2 step 6). Video registration and channel verification UI arrive with S4-M9. */
export default async function LicensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await requireBuyerSession(`/licenses/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const actor = await resolveBuyerActor(db, session.userId, id);
  const view = actor ? await getLicenseForBuyer(db, actor, id) : null;
  if (!view) notFound();
  const l = view.license;
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-semibold">{l.trackTitle}</h1>
      <p className="text-gray-600">
        {l.primaryArtist} · {TIER_LABELS[l.tier as Tier]} · <span className="font-mono">{l.publicId}</span>
      </p>
      <p className="mt-1 text-sm">
        Status: <strong>{l.effectiveStatus}</strong> · {l.endsAt ? `${ist(l.startsAt)} to ${ist(l.endsAt)}` : `perpetual from ${ist(l.startsAt)}`}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {ERRORS[error] ?? 'Something went wrong.'}
        </p>
      )}

      <h2 className="mt-6 font-semibold">Documents</h2>
      <ul className="mt-1 list-disc pl-5 text-sm">
        <li>
          <a className="underline" href={`/licenses/${l.id}/documents/certificate`}>Certificate (PDF)</a>
        </li>
        <li>
          <a className="underline" href={`/licenses/${l.id}/documents/invoice`}>Tax invoice (PDF)</a>
        </li>
        <li>
          <a className="underline" href={`/licenses/${l.id}/documents/dispute-kit`}>Dispute kit (PDF)</a>
        </li>
        <li>
          <a className="underline" href={verifyUrl(l.publicId)}>Public verify page</a>
        </li>
      </ul>

      <h2 className="mt-6 font-semibold">Clean files</h2>
      <p className="text-sm text-gray-600">
        {view.downloadsUsed} of {view.downloadsCap} downloads used. Each link is valid for 15 minutes.
      </p>
      <div className="mt-2 flex gap-2">
        <form action={downloadAction.bind(null, l.id, 'master')}>
          <button className="border px-3 py-1" disabled={l.effectiveStatus !== 'active'}>
            Download master
          </button>
        </form>
        <form action={downloadAction.bind(null, l.id, 'mp3')}>
          <button className="border px-3 py-1" disabled={l.effectiveStatus !== 'active'}>
            Download MP3 320
          </button>
        </form>
      </div>

      <h2 className="mt-6 font-semibold">Channels</h2>
      <ul className="mt-1 text-sm">
        {view.channels.map((c) => (
          <li key={c.id}>
            {c.platform}: {c.handleOrUrl} <span className="text-gray-500">({c.verificationStatus})</span>
          </li>
        ))}
      </ul>
      <h2 className="mt-6 font-semibold">Registered videos</h2>
      {view.videos.length === 0 ? (
        <p className="text-sm text-gray-600">None yet. Upload privately first, register the video, then publish once clearance is complete.</p>
      ) : (
        <ul className="mt-1 text-sm">
          {view.videos.map((v) => (
            <li key={v.id}>
              {v.label}: {v.urls.join(', ')}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-8 border p-3 text-sm">{CLEARANCE_NOTICE}</p>
    </main>
  );
}
