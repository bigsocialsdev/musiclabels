import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDateTime, own } from '@/components/store/format';
import { StatusLabel } from '@/components/ui/status';
import { listReviewQueue } from '@/lib/catalog/server';
import { getDb } from '@/lib/platform/db';
import { requireVerificationAdmin } from './guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Verification | MRM Admin', robots: { index: false } };

const DONE: Record<string, string> = { approved: 'Track approved.', rejected: 'Track rejected.' };

/** Submitted tracks waiting for review, oldest first (PLAN §9). */
export default async function VerificationQueue({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  await requireVerificationAdmin('/admin/verification');
  const { done } = await searchParams;
  const rows = await listReviewQueue(getDb());
  return (
    <Page width="wide">
      <PageHeader title="Verification">Submitted tracks waiting for review, oldest first.</PageHeader>
      {own(DONE, done) && (
        <Notice tone="ok" role="status">
          {own(DONE, done)}
        </Notice>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting for review.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Track</Th>
              <Th>Seller</Th>
              <Th>Screening</Th>
              <Th num>Probes</Th>
              <Th>Waiting since</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.trackId}>
                <Td>
                  <Link className="font-semibold hover:underline" href={`/admin/verification/${r.trackId}`}>
                    {r.title}
                  </Link>
                  <div className="text-[13px] text-muted-foreground">{r.primaryArtist}</div>
                </Td>
                <Td>{r.sellerName}</Td>
                <Td>
                  <StatusLabel tone={r.screeningStatus ? 'info' : 'muted'}>{(r.screeningStatus ?? 'pending').replaceAll('_', ' ')}</StatusLabel>
                </Td>
                <Td num>{r.probeCount}</Td>
                <Td className="whitespace-nowrap text-fg-2">{istDateTime(r.submittedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
