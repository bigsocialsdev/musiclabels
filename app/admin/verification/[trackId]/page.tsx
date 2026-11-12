import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PRICE_LEVELS, getReviewDetail } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { approveAction, probeAction, rejectAction } from '../actions';
import { requireVerificationAdmin } from '../guard';

export const dynamic = 'force-dynamic';

export default async function ReviewTrack({
  params,
  searchParams,
}: {
  params: Promise<{ trackId: string }>;
  searchParams: Promise<{ error?: string; probe?: string }>;
}) {
  const { trackId } = await params;
  await requireVerificationAdmin(`/admin/verification/${trackId}`);
  if (!z.uuid().safeParse(trackId).success) notFound();
  const { error, probe } = await searchParams;
  const detail = await getReviewDetail(getDb(), trackId);
  if (!detail) notFound();
  const { track, version, facts, declaration, documents } = detail;
  const inReview = track.status === 'in_review';

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <p>
        <Link className="underline" href="/admin/verification">
          ← Queue
        </Link>
      </p>
      <h1 className="text-xl font-semibold">
        {track.title} <span className="text-base font-normal text-gray-600">{track.primaryArtist}</span>
      </h1>
      <p className="text-sm">
        Status: <b>{track.status}</b> · language {track.language} · seller proposed {track.proposedPriceLevel ?? 'no price'} · composers {track.composers.join(', ') || '—'}
      </p>
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-red-700">
          {error}
        </p>
      )}
      {probe && <p role="status" className="text-green-700">Claim probe saved.</p>}

      <section>
        <h2 className="font-medium">Audio</h2>
        {version ? (
          <p className="text-sm">
            Version {version.versionNo}: ingest <b>{version.ingestStatus}</b>
            {version.ingestError ? ` (${version.ingestError})` : ''}
            {version.durationMs ? ` · ${Math.round(version.durationMs / 1000)} s · ${version.sampleRate} Hz · ${version.masterFormat}` : ''}
          </p>
        ) : (
          <p className="text-sm">No audio uploaded.</p>
        )}
      </section>

      <section>
        <h2 className="font-medium">Screening</h2>
        {facts?.screening ? (
          <div className="text-sm">
            <p>
              {facts.screening.provider}: <b>{facts.screening.status}</b>
            </p>
            <ul className="list-disc pl-5">
              {facts.screening.matches.map((m, i) => (
                <li key={i}>
                  {m.title} — {m.artist}
                  {m.label ? ` (${m.label})` : ''} {m.score != null ? `score ${m.score}` : ''} [{m.source}]
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm">Not screened yet.</p>
        )}
      </section>

      <section>
        <h2 className="font-medium">Rights</h2>
        {declaration ? (
          <p className="text-sm">
            Declared {declaration.declaredAt.toISOString().slice(0, 10)} · registrations: {(declaration.registrations as { system: string; administeredBy: string }[]).map((r) => `${r.system} (${r.administeredBy})`).join(', ') || 'none'}
          </p>
        ) : (
          <p className="text-sm">No declaration.</p>
        )}
        <ul className="mt-1 list-disc pl-5 text-sm">
          {documents.map((d) => (
            <li key={d.id}>
              {d.docType} ·{' '}
              {d.validationStatus === 'valid' ? (
                <a className="underline" href={`/admin/verification/${track.id}/documents/${d.id}`}>
                  download
                </a>
              ) : (
                <span>{d.validationStatus}{d.validationError ? `: ${d.validationError}` : ''}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {version && (
        <section>
          <h2 className="font-medium">Claim probes</h2>
          <ul className="list-disc pl-5 text-sm">
            {facts?.probes.map((p) => (
              <li key={p.id}>
                {p.platform}: {p.claims.length ? p.claims.map((c) => `${c.claimant} (${c.policy || 'no policy'})`).join(', ') : 'no claims'} {p.notes ? `— ${p.notes}` : ''}
              </li>
            ))}
          </ul>
          <form action={probeAction.bind(null, track.id)} className="mt-2 flex flex-wrap items-end gap-2 text-sm">
            <select name="platform" className="rounded border p-1">
              <option value="youtube">YouTube</option>
              <option value="meta">Meta</option>
            </select>
            <input name="claimant" placeholder="Claimant (blank = no claim)" className="rounded border p-1" />
            <input name="policy" placeholder="Policy" className="rounded border p-1" />
            <input name="notes" placeholder="Notes" className="rounded border p-1" />
            <button className="rounded border px-3 py-1">Record probe</button>
          </form>
        </section>
      )}

      {inReview && (
        <>
          <section>
            <h2 className="font-medium">Approve</h2>
            <form action={approveAction.bind(null, track.id)} className="mt-2 space-y-2 text-sm">
              <div className="flex gap-2">
                <select name="clearanceClass" className="rounded border p-1" defaultValue="A">
                  <option value="A">Class A</option>
                  <option value="B">Class B</option>
                </select>
                <select name="priceLevel" className="rounded border p-1" defaultValue={track.proposedPriceLevel ?? 'L1'}>
                  {PRICE_LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <textarea name="overrideNote" placeholder="Override note (required when screening matched or was unavailable)" className="w-full rounded border p-1" rows={2} />
              <button className="rounded bg-black px-4 py-1 text-white">Approve and publish</button>
            </form>
          </section>
          <section>
            <h2 className="font-medium">Reject</h2>
            <form action={rejectAction.bind(null, track.id)} className="mt-2 space-y-2 text-sm">
              <textarea name="reason" required placeholder="Reason shown to the seller" className="w-full rounded border p-1" rows={2} />
              <label className="block">
                <input type="checkbox" name="classC" /> Class C: cannot be cleared
              </label>
              <button className="rounded border border-red-600 px-4 py-1 text-red-700">Reject</button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
