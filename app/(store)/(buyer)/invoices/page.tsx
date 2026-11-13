import type { Metadata } from 'next';
import Link from 'next/link';
import { Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { requireBuyerSession } from '@/app/buyer-session';
import { docActionClass } from '@/components/store/doc-row';
import { istDate } from '@/components/store/format';
import { formatInr } from '@/lib/invoicing';
import { listBuyerBilling } from '@/lib/invoicing/server';
import { getDb } from '@/lib/platform/db';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invoices | MRM', robots: { index: false } };

/** Tax invoices and the credit notes that reverse them, for every license bought by the user's orgs. */
export default async function InvoicesPage() {
  const session = await requireBuyerSession('/invoices');
  const rows = await listBuyerBilling(getDb(), session.userId);
  return (
    <Page width="wide">
      <PageHeader title="Invoices">Every sale is invoiced by the platform with GST. A refund is a credit note against the invoice, never an edit to it.</PageHeader>
      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-6">
          <p className="text-title">No invoices yet</p>
          <p className="mt-1 text-sm text-muted-foreground">An invoice is issued with each license.</p>
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Track</Th>
              <Th num>Taxable</Th>
              <Th num>GST</Th>
              <Th num>Total</Th>
              <Th>Credit note</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.invoice.number}>
                <Td>
                  <div className="font-mono text-[13px] font-normal">{r.invoice.number}</div>
                  <div className="text-[13px] text-muted-foreground">{istDate(r.invoice.issuedAt)}</div>
                </Td>
                <Td>
                  <Link href={`/licenses/${r.licenseId}`} className="font-semibold hover:underline">
                    {r.trackTitle}
                  </Link>
                </Td>
                <Td num>{formatInr(r.invoice.taxablePaise)}</Td>
                <Td num>{formatInr(r.invoice.cgstPaise + r.invoice.sgstPaise + r.invoice.igstPaise)}</Td>
                <Td num>{formatInr(r.invoice.totalPaise)}</Td>
                <Td>
                  {r.creditNote ? (
                    <>
                      <div className="font-mono text-[13px] font-normal">{r.creditNote.number}</div>
                      <div className="text-[13px] text-muted-foreground">{istDate(r.creditNote.issuedAt)}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap">
                  {r.invoice.hasPdf && (
                    <a className={docActionClass} href={`/licenses/${r.licenseId}/documents/invoice`}>
                      Invoice
                    </a>
                  )}
                  {r.creditNote?.hasPdf && (
                    <a className={docActionClass} href={`/licenses/${r.licenseId}/documents/credit-note`}>
                      Credit note
                    </a>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
