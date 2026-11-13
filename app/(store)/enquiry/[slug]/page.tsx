import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublishedTrack } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { EnquiryForm } from './enquiry-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Enquire about a license | MRM', robots: { index: false } };

/** Television, OTT and cinema are quoted by hand (PLAN §6.1): this form is the whole flow, with no checkout behind it. */
export default async function EnquiryPage({ params }: { params: Promise<{ slug: string }> }) {
  const track = await getPublishedTrack(getDb(), { slug: (await params).slug });
  if (!track) notFound();
  return (
    <main className="mx-auto max-w-[640px] px-4 pt-8 pb-20 min-[901px]:px-6">
      <Link href={`/track/${track.slug}`} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
        ← {track.title}
      </Link>
      <h1 className="mt-3 text-headline max-[900px]:text-xl">Enquire about “{track.title}”</h1>
      <p className="mt-1.5 mb-6 text-sm text-muted-foreground">Television, OTT and cinema licenses are quoted by our team. Tell us about the project and we will reply by email.</p>
      <EnquiryForm trackId={track.id} slug={track.slug} />
    </main>
  );
}
