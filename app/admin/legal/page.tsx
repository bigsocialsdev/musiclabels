import type { Metadata } from 'next';
import { Notice, Page, PageHeader, selectClass } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDateTime, own } from '@/components/store/format';
import { Button } from '@/components/ui/button';
import { LEGAL_KINDS, listLegalDocuments } from '@/lib/legal/server';
import { getDb } from '@/lib/platform/db';
import { requireAdminArea } from '../guard';
import { publishLegalAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Legal documents | MRM Admin', robots: { index: false } };

const KIND_LABEL: Record<string, string> = {
  tos: 'Terms of service',
  privacy: 'Privacy policy',
  seller_agreement: 'Seller agreement',
  release_commitment: 'Release commitment (Class B)',
  license_creator: 'License text: Creator',
  license_brand_organic: 'License text: Brand organic',
  license_paid_ad: 'License text: Paid ad',
};
const ERRORS: Record<string, string> = { bad_input: 'Choose a document, paste the full text (at least 20 characters), tick the confirmation, and use a valid effective time or leave it blank.' };

/** Legal documents (PLAN §9, superadmin): every published version with how many users accepted it, and a form to publish the next one. Versions are immutable. */
export default async function LegalPage({ searchParams }: { searchParams: Promise<{ done?: string; kind?: string; version?: string; error?: string }> }) {
  const admin = await requireAdminArea('superadmin', '/admin/legal');
  const { done, kind, version, error } = await searchParams;
  const docs = await listLegalDocuments(getDb(), admin);

  return (
    <Page width="wide">
      <PageHeader title="Legal documents">A published version can never be edited; a fix is a new version. Publishing a new terms or privacy version asks every user to accept it again at their next sign-in.</PageHeader>
      {own(ERRORS, error) && (
        <Notice tone="attention" role="alert">
          {own(ERRORS, error)}
        </Notice>
      )}
      {done === 'published' && (
        <Notice tone="ok" role="status">
          Published {own(KIND_LABEL, kind) ?? 'the document'} version {Number(version) || ''}.
        </Notice>
      )}

      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Publish a new version</h2>
        <form action={publishLegalAction} className="grid max-w-3xl gap-3">
          <div className="grid gap-1">
            <label htmlFor="kind" className="text-[13px] font-semibold text-muted-foreground">
              Document
            </label>
            <select id="kind" name="kind" className={selectClass}>
              {LEGAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {own(KIND_LABEL, k) ?? k}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="body" className="text-[13px] font-semibold text-muted-foreground">
              Full text (Markdown)
            </label>
            <textarea id="body" name="body" required minLength={20} maxLength={200000} rows={12} className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-[13px] outline-none focus-visible:border-ring" />
          </div>
          <div className="grid gap-1">
            <label htmlFor="effectiveAt" className="text-[13px] font-semibold text-muted-foreground">
              Effective from (IST, blank = now)
            </label>
            <input id="effectiveAt" name="effectiveAt" type="datetime-local" className="h-9 w-64 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="confirm" required className="mt-1" />
            <span>I have checked the text. This version cannot be changed or removed after publishing.</span>
          </label>
          <div>
            <Button type="submit">Publish version</Button>
          </div>
        </form>
      </section>

      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Published versions</h2>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is published yet. Checkout and sign-up stay closed until the terms and privacy policy are.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Version</Th>
                <Th>Effective</Th>
                <Th>Accepted by</Th>
                <Th>SHA-256</Th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <Td className="font-semibold">{own(KIND_LABEL, d.kind) ?? d.kind}</Td>
                  <Td>v{d.version}</Td>
                  <Td className="whitespace-nowrap text-fg-2">{istDateTime(d.effectiveAt)}</Td>
                  <Td>{d.accepted}</Td>
                  <Td className="font-mono text-[12px] text-fg-2">{d.sha256.slice(0, 16)}…</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </Page>
  );
}
