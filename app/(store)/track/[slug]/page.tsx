import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { TIER_LABELS } from '@/lib/certificates';
import { suggestTracks, trackCardBySlug } from '@/lib/catalog/server';
import { previewReceipt } from '@/lib/orders/server';
import { getEnv } from '@/lib/platform/env';
import { RateLimited } from '@/components/store/rate-limited';
import { getDb } from '@/lib/platform/db';
import { allowByIp, LIMITS } from '@/lib/platform/ratelimit';
import { Discovery } from '../../discovery';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

const load = cache(async (slug: string) => trackCardBySlug(getDb(), slug));

const isoDuration = (ms: number) => `PT${Math.floor(ms / 60_000)}M${Math.round((ms % 60_000) / 1000)}S`;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const track = await load((await params).slug);
  if (!track) return { title: 'Track not found | MRM', robots: { index: false } };
  const url = `${getEnv().APP_URL}/track/${track.slug}`;
  const title = `${track.title} by ${track.primaryArtist}: license for video | MRM`;
  const description = `Preview “${track.title}” and license it for your videos. Every license comes with a certificate and a GST invoice.`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: 'music.song' } };
}

/** The track page: the same stage, player and receipt as discovery, with alternatives where the list would be. */
export default async function TrackPage({ params }: Props) {
  const { slug } = await params;
  const db = getDb();
  if (!(await allowByIp('storefront', await headers(), LIMITS.storefront, db))) return <RateLimited />;
  const track = await load(slug);
  if (!track) notFound();
  const [similar, receipt] = await Promise.all([suggestTracks(db, track.id, { limit: 8 }), previewReceipt(db, track.id)]);

  const offers = receipt
    .filter((t) => t.available && t.amountPaise !== undefined)
    .map((t) => ({ '@type': 'Offer', name: TIER_LABELS[t.tier], price: (t.amountPaise! / 100).toFixed(2), priceCurrency: 'INR', availability: 'https://schema.org/InStock', url: `${getEnv().APP_URL}/track/${track.slug}` }));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    name: track.title,
    byArtist: { '@type': 'MusicGroup', name: track.primaryArtist },
    inLanguage: track.language === 'instrumental' ? undefined : track.language,
    duration: track.durationMs ? isoDuration(track.durationMs) : undefined,
    genre: track.genre ?? undefined,
    url: `${getEnv().APP_URL}/track/${track.slug}`,
    offers,
  };

  return (
    <>
      {/* The title and artist are seller-written: escape "<" so they can never close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Discovery
        key={track.id}
        tracks={[track, ...similar]}
        rail={null}
        chips={null}
        header={
          <div id="similar" className="mb-2.5 scroll-mt-24">
            <h2 className="text-headline max-[900px]:text-xl">{similar.length ? 'Similar tracks' : 'Nothing similar yet'}</h2>
            {similar.length > 0 && <p className="mt-1 text-sm text-muted-foreground">Same feel, and you can buy each of them today.</p>}
          </div>
        }
        footer={null}
        stageOnly
      />
    </>
  );
}
