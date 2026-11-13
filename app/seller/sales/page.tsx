import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatInr } from '@/lib/invoicing';
import { getSellerBalances, listSellerLedger } from '@/lib/ledger/server';
import { getDb } from '@/lib/platform/db';
import { fmtDate } from '../format';
import { requireSellerSession } from '../session';
import { KIND_LABELS } from './labels';

export const dynamic = 'force-dynamic';

export default async function SellerSalesPage() {
  const { session, orgId } = await requireSellerSession('/seller/sales');
  if (!orgId) redirect('/seller/onboarding');
  const db = getDb();
  const actor = { userId: session.userId, orgId };
  const [rows, balances] = await Promise.all([listSellerLedger(db, actor, { limit: 200 }), getSellerBalances(db, actor)]);
  const now = new Date();
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Sales and royalties</h1>
        <Link href="/seller/sales/export" className={buttonVariants({ variant: 'outline' })}>
          Download CSV
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Ready for the next payout run</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInr(balances.availablePaise)}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">On hold (30 days after each sale)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{formatInr(balances.heldPaise)}</CardContent>
        </Card>
      </div>
      <p className="text-sm text-muted-foreground">
        Royalties are paid once a month to your verified bank account, after the 30-day hold. They cannot be withdrawn earlier. Amounts exclude GST. See <Link href="/seller/payouts" className="underline">payouts</Link> for what has been paid.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sales yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2 font-medium">Date</th>
                <th className="p-2 font-medium">What</th>
                <th className="p-2 font-medium">Track</th>
                <th className="p-2 text-right font-medium">Sale value</th>
                <th className="p-2 text-right font-medium">Royalty</th>
                <th className="p-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{fmtDate(r.at)}</td>
                  <td className="p-2">{KIND_LABELS[r.kind]}</td>
                  <td className="p-2">{r.trackTitle ? `${r.trackTitle}${r.tier ? ` (${r.tier})` : ''}` : '—'}</td>
                  <td className="p-2 text-right">{r.taxablePaise === null ? '—' : formatInr(r.taxablePaise)}</td>
                  <td className="p-2 text-right font-medium">{formatInr(r.amountPaise)}</td>
                  <td className="p-2 whitespace-nowrap text-muted-foreground">
                    {r.kind === 'payout' ? 'Paid out' : r.availableAt > now ? `On hold until ${fmtDate(r.availableAt)}` : 'Matured'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 200 && <p className="text-xs text-muted-foreground">Showing the latest 200 entries. The CSV has more.</p>}
    </main>
  );
}
