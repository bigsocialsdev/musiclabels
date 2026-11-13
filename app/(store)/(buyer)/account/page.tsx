import type { Metadata } from 'next';
import { Page, PageHeader } from '@/app/seller/ui';
import { requireBuyerSession } from '@/app/buyer-session';
import { Button } from '@/components/ui/button';
import { StatusLabel } from '@/components/ui/status';
import { maskName } from '@/lib/certificates';
import { listBuyerOrgs } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';
import { verifyDisplayAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Account | MRM', robots: { index: false } };

/** What the public verify page shows about the buyer (PLAN §7): organisations in full, individuals masked unless they opt in. */
export default async function AccountPage() {
  const session = await requireBuyerSession('/account');
  const orgs = await listBuyerOrgs(getDb(), session.userId);
  return (
    <Page>
      <PageHeader title="Account">Your organisations and what the public verify page shows about them.</PageHeader>
      {orgs.length === 0 && <p className="text-sm text-muted-foreground">You are not part of a buyer organisation yet. One is created when you buy your first license.</p>}
      <ul className="grid gap-3">
        {orgs.map((o) => (
          <li key={o.id} className="space-y-3 rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-title">{o.legalName}</p>
              <span className="text-[13px] text-muted-foreground capitalize">{o.buyerType}</span>
            </div>
            {o.buyerType === 'individual' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {o.verifyFullName ? (
                    <>Anyone who looks up one of your licenses on the verify page sees your full name. Masking it shows <span className="font-mono font-normal text-foreground">{maskName(o.legalName)}</span> instead.</>
                  ) : (
                    <>Anyone who looks up one of your licenses on the verify page sees your name as <span className="font-mono font-normal text-foreground">{maskName(o.legalName)}</span> unless you choose to show it in full.</>
                  )}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <StatusLabel tone={o.verifyFullName ? 'attention' : 'ok'}>{o.verifyFullName ? 'Full name shown' : 'Name masked'}</StatusLabel>
                  {o.role === 'owner' ? (
                    <form action={verifyDisplayAction}>
                      <input type="hidden" name="orgId" value={o.id} />
                      <input type="hidden" name="show" value={o.verifyFullName ? 'off' : 'on'} />
                      <Button type="submit" variant="secondary">
                        {o.verifyFullName ? 'Mask my name' : 'Show my full name'}
                      </Button>
                    </form>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">Only the account owner can change this.</span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Business and agency names are always shown in full on the verify page, next to the client name when there is one.</p>
            )}
          </li>
        ))}
      </ul>
    </Page>
  );
}
