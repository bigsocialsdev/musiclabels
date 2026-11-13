import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { formatInr } from '@/lib/invoicing';
import { listSellerPayouts, type SellerPayoutRow } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { fmtDate } from '../format';
import { requireSellerSession } from '../session';

export const dynamic = 'force-dynamic';

const STATUS: Record<SellerPayoutRow['status'], { label: string; variant: 'default' | 'outline' | 'destructive' }> = {
  pending: { label: 'Being prepared', variant: 'outline' },
  processing: { label: 'Sent to the bank', variant: 'outline' },
  paid: { label: 'Paid', variant: 'default' },
  failed: { label: 'Failed, carried to the next run', variant: 'destructive' },
};

export default async function SellerPayoutsPage() {
  const { session, orgId } = await requireSellerSession('/seller/payouts');
  if (!orgId) redirect('/seller/onboarding');
  const rows = await listSellerPayouts(getDb(), { userId: session.userId, orgId });
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Payouts</h1>
      <p className="text-sm text-muted-foreground">
        Paid monthly once your royalties are past the 30-day hold, your KYC and bank account are verified and the total reaches the minimum. The statement shows how tax was applied. See <Link href="/seller/sales" className="underline">sales</Link> for the entries behind it.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payouts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2 font-medium">Period</th>
                <th className="p-2 text-right font-medium">Royalty</th>
                <th className="p-2 text-right font-medium">TDS</th>
                <th className="p-2 text-right font-medium">GST</th>
                <th className="p-2 text-right font-medium">Net paid</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Statement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{p.period}</td>
                  <td className="p-2 text-right">{formatInr(p.royaltyBasePaise)}</td>
                  <td className="p-2 text-right">{formatInr(p.tdsPaise)}</td>
                  <td className="p-2 text-right">{p.sellerGstPaise > 0 ? formatInr(p.sellerGstPaise) : '—'}</td>
                  <td className="p-2 text-right font-medium">{formatInr(p.netPaise)}</td>
                  <td className="p-2">
                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                    {p.paidAt && <div className="text-xs text-muted-foreground">{fmtDate(p.paidAt)}{p.utr ? ` · UTR ${p.utr}` : ''}</div>}
                  </td>
                  <td className="p-2">
                    {p.hasStatement ? (
                      <a href={`/seller/payouts/${p.id}/statement`} className="underline">
                        PDF
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
