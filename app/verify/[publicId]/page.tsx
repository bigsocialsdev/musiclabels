import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { TIER_LABELS } from '@/lib/certificates';
import { getVerifyView } from '@/lib/certificates/server';
import { getDb } from '@/lib/platform/db';
import { consume } from '@/lib/platform/ratelimit';
import { clientIp } from '@/lib/platform/request';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verify a license', robots: { index: false, follow: false } };

const VERIFY_LIMIT = { capacity: 30, refillPerSecond: 30 / 60 };
const ist = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' });

/** Public verify page (PLAN §7): read live from the database, rate-limited per IP, uniform 404 for unknown ids. */
export default async function VerifyPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const ip = clientIp(await headers()) ?? 'unknown';
  if (!(await consume(`verify:${ip}`, VERIFY_LIMIT))) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p role="alert">Too many lookups. Try again in a minute.</p>
      </main>
    );
  }
  const v = await getVerifyView(getDb(), publicId); // malformed or unknown ids fall through to the same 404
  if (!v) notFound();
  const statusText = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }[v.status];
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p className="text-sm text-gray-600">Music Rights Marketplace — license verification</p>
      <h1 className="mt-1 text-xl font-semibold">
        <span className="font-mono">{v.publicId}</span>
      </h1>
      <p className={`mt-2 font-semibold ${v.status === 'active' ? 'text-green-700' : 'text-red-700'}`}>{statusText}</p>
      <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-1 text-sm">
        <dt>Track</dt>
        <dd>
          {v.trackTitle} — {v.primaryArtist}
        </dd>
        <dt>License</dt>
        <dd>{TIER_LABELS[v.tier]}</dd>
        <dt>Licensee</dt>
        <dd>{v.licensee}</dd>
        {v.purchaser && (
          <>
            <dt>Purchased by</dt>
            <dd>{v.purchaser}</dd>
          </>
        )}
        <dt>Term</dt>
        <dd>{v.endsAt ? `${ist(v.startsAt)} to ${ist(v.endsAt)}` : `Perpetual from ${ist(v.startsAt)}`}</dd>
        <dt>Territory</dt>
        <dd>{v.territory === 'worldwide' ? 'Worldwide (online distribution)' : v.territory}</dd>
        <dt>Issued</dt>
        <dd>{ist(v.issuedAt)}</dd>
        <dt>License text</dt>
        <dd>Version {v.licenseTextVersion}</dd>
        <dt>Channels</dt>
        <dd>
          {v.channels.map((c) => (
            <div key={`${c.platform}:${c.handleOrUrl}`}>
              {c.platform}: {c.handleOrUrl} <span className="text-gray-600">({c.verificationStatus})</span>
            </div>
          ))}
        </dd>
        <dt>Record hash</dt>
        <dd className="break-all font-mono text-xs">{v.recordHash}</dd>
      </dl>
      <p className={`mt-3 text-sm ${v.recordIntact ? 'text-green-700' : 'text-red-700'}`}>
        {v.recordIntact ? 'Record intact: the stored license matches its hash.' : 'This record does not match its hash. Our team has been alerted.'}
      </p>
    </main>
  );
}
