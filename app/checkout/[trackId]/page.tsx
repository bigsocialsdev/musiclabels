import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getPublishedTrack } from '@/lib/catalog/server';
import { TIER_LABELS } from '@/lib/certificates';
import { listBuyerOrgs } from '@/lib/identity/server';
import { GST_STATES, formatInr } from '@/lib/invoicing';
import { getLegalDocument } from '@/lib/legal/server';
import { TIERS, getTermsVersion, quoteLicense } from '@/lib/licensing/server';
import { getDb } from '@/lib/platform/db';
import { requireBuyerSession } from '../../buyer-session';
import { createBuyerOrgAction } from '../actions';
import { CheckoutForm } from './checkout-form';

export const dynamic = 'force-dynamic';

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ trackId: string }>; searchParams: Promise<{ tier?: string; error?: string }> }) {
  const { trackId } = await params;
  const { tier: rawTier, error } = await searchParams;
  const tier = z.enum(TIERS).catch('creator').parse(rawTier);
  const returnTo = `/checkout/${trackId}?tier=${tier}`;
  const session = await requireBuyerSession(returnTo);
  const db = getDb();
  const track = z.uuid().safeParse(trackId).success ? await getPublishedTrack(db, { id: trackId }) : null;
  if (!track) notFound();

  const orgs = await listBuyerOrgs(db, session.userId);
  if (orgs.length === 0) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Who is buying?</h1>
        {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
        <form action={createBuyerOrgAction.bind(null, returnTo)} className="mt-4 space-y-3">
          <label className="block">
            Legal name (yours, or your company&apos;s)
            <input name="legalName" required className="mt-1 block w-full border p-2" />
          </label>
          <label className="block">
            Buying as
            <select name="buyerType" className="mt-1 block w-full border p-2" defaultValue="individual">
              <option value="individual">An individual creator</option>
              <option value="business">A business</option>
              <option value="agency">An agency buying for clients</option>
            </select>
          </label>
          <button className="border px-4 py-2">Continue</button>
        </form>
      </main>
    );
  }

  const quote = await quoteLicense(db, track.id, tier);
  if (!quote.ok) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">{track.title}</h1>
        <p className="mt-2">The {TIER_LABELS[tier]} license is not available for this track.</p>
      </main>
    );
  }
  const terms = (await getTermsVersion(db, quote.value.termsVersionId))!;
  const text = await getLegalDocument(db, terms.licenseTextDocumentId);

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">
        {TIER_LABELS[tier]} license — {track.title}
      </h1>
      <p className="text-gray-600">
        {track.primaryArtist} · {formatInr(quote.value.amountPaise)} + GST
        {terms.termKind === 'fixed_months' ? ` · ${terms.termMonths} months` : ' · perpetual'}
        {terms.videoCap ? ` · up to ${terms.videoCap} video${terms.videoCap > 1 ? 's' : ''}` : ''}
      </p>
      <details className="mt-4 border p-3 text-sm">
        <summary>License text (version {terms.licenseTextVersion})</summary>
        <pre className="mt-2 whitespace-pre-wrap">{text?.bodyMarkdown}</pre>
      </details>
      <CheckoutForm
        trackId={track.id}
        trackTitle={track.title}
        tier={tier}
        orgs={orgs.map((o) => ({ id: o.id, legalName: o.legalName, buyerType: o.buyerType ?? 'individual' }))}
        maxChannels={terms.maxChannels}
        platforms={terms.allowedPlatforms}
        states={Object.entries(GST_STATES)}
      />
    </main>
  );
}
