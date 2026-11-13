import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice, Page, PageHeader } from '@/app/seller/ui';
import { istDate, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { listKycQueue } from '@/lib/accounts/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { decideKycAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'KYC | MRM Admin', robots: { index: false } };

const FILTERS = ['pending', 'verified', 'rejected'] as const;
const DONE: Record<string, string> = { verified: 'Marked verified.', rejected: 'Marked rejected.', pending: 'Sent back to pending.' };
const ERRORS: Record<string, string> = {
  need_note: 'Write a note for the decision.',
  incomplete: 'Verification needs a PAN on file and a PAN card document that passed its checks.',
  not_found: 'That seller no longer exists.',
};
const textInput = 'h-9 w-64 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring';

/** Seller KYC (PLAN §9): who is waiting, what they uploaded, and the decision with a note. Documents open as audited downloads; the PAN is never shown. */
export default async function KycPage({ searchParams }: { searchParams: Promise<{ status?: string; done?: string; error?: string }> }) {
  const admin = await requireAdminArea('verification', '/admin/kyc');
  const { status: rawStatus, done, error } = await searchParams;
  const status = FILTERS.find((f) => f === rawStatus) ?? 'pending';
  const rows = await listKycQueue(getDb(), admin, status);

  return (
    <Page width="wide">
      <PageHeader title="Seller KYC">Sellers cannot be paid out until their KYC is verified. Open a document to review it; each opening is logged.</PageHeader>
      <nav aria-label="KYC status" className="flex gap-4 text-[13px] font-semibold">
        {FILTERS.map((f) => (
          <Link key={f} href={`/admin/kyc?status=${f}`} aria-current={f === status ? 'page' : undefined} className="text-muted-foreground capitalize underline-offset-4 hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline">
            {f}
          </Link>
        ))}
      </nav>
      {own(DONE, done) && (
        <Notice tone="ok" role="status">
          {own(DONE, done)}
        </Notice>
      )}
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sellers with KYC {status}.</p>
      ) : (
        <ul className="grid gap-4">
          {rows.map((r) => (
            <li key={r.orgId} className="grid gap-3 rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-title">{r.displayName}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {r.legalName} · {r.entityType} · {r.onboardingMode.replace('_', ' ')} · {r.ownerEmail ?? 'no owner email'} · since {istDate(r.since)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <StatusLabel tone={r.hasPan ? 'ok' : 'attention'}>{r.hasPan ? 'PAN on file' : 'No PAN'}</StatusLabel>
                  {r.sellerStatus !== 'active' && <StatusLabel tone="blocked">Account {r.sellerStatus}</StatusLabel>}
                </div>
              </div>
              {r.documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded.</p>
              ) : (
                <ul className="grid gap-1 text-sm">
                  {r.documents.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold">{d.kind.replace(/_/g, ' ')}</span>
                      <span className="text-muted-foreground">
                        {d.status}
                        {d.error ? `: ${d.error}` : ''} · {istDate(d.uploadedAt)}
                      </span>
                      {d.status === 'valid' && (
                        <a href={`/admin/kyc/${r.orgId}/documents/${d.id}`} className="font-semibold underline underline-offset-4">
                          Download
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <form className="flex flex-wrap items-end gap-2">
                <div className="grid gap-1">
                  <label htmlFor={`note-${r.orgId}`} className="text-[13px] font-semibold text-muted-foreground">
                    Note for the decision
                  </label>
                  <input id={`note-${r.orgId}`} name="note" required maxLength={1000} className={textInput} />
                </div>
                {status !== 'verified' && (
                  <Button type="submit" formAction={decideKycAction.bind(null, r.orgId, 'verified')}>
                    Verify
                  </Button>
                )}
                {status !== 'rejected' && (
                  <Button type="submit" variant="destructive" formAction={decideKycAction.bind(null, r.orgId, 'rejected')}>
                    Reject
                  </Button>
                )}
                {status !== 'pending' && (
                  <Button type="submit" variant="secondary" formAction={decideKycAction.bind(null, r.orgId, 'pending')}>
                    Send back to pending
                  </Button>
                )}
              </form>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
