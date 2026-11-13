import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { Textarea } from '@/components/ui/textarea';
import { listSellerClearance, type SellerClearanceRow } from '@/lib/clearance/server';
import { getDb } from '@/lib/platform/db';
import { FlashBanner } from '../flash';
import { fmtDate } from '../format';
import { requireSellerSession } from '../session';
import { Page, PageHeader } from '../ui';
import { respondClearanceAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS: Record<SellerClearanceRow['status'], { label: string; tone: StatusTone }> = {
  not_required: { label: 'Not needed', tone: 'muted' },
  pending: { label: 'Waiting to be sent', tone: 'muted' },
  sent: { label: 'Waiting for you', tone: 'attention' },
  overdue: { label: 'Overdue', tone: 'blocked' },
  escalated: { label: 'Escalated to our team', tone: 'info' },
  completed: { label: 'Released', tone: 'ok' },
  failed: { label: 'Declined', tone: 'blocked' },
};

export default async function SellerClearancePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const { session, orgId } = await requireSellerSession('/seller/clearance');
  if (!orgId) redirect('/seller/onboarding');
  const rows = await listSellerClearance(getDb(), { userId: session.userId, orgId });
  const now = new Date();
  return (
    <Page>
      <PageHeader title="Clearance requests">
        When a buyer registers a channel or video for a track you have marked as possibly claimable elsewhere, we ask you to release any claim on it. Answering here is the same as using the link in the email. Releasing is your commitment; if you cannot release, say so and our team will help the buyer.
      </PageHeader>
      <FlashBanner token={m} />
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No clearance requests yet.</p>}
      {rows.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-2">
              {r.trackTitle}
              <StatusLabel tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusLabel>
            </CardTitle>
            <CardDescription>
              {r.licenseeName} registered {r.what}.{r.dueAt && r.awaitingSeller && ` Please answer by ${fmtDate(r.dueAt)}${r.dueAt < now ? ' (past due)' : ''}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {r.respondedAt && (
              <p className="text-sm">
                Answered on {fmtDate(r.respondedAt)}.{r.sellerNote && <span className="text-muted-foreground"> Your note: {r.sellerNote}</span>}
              </p>
            )}
            {r.awaitingSeller && (
              <form action={respondClearanceAction} className="space-y-3">
                <input type="hidden" name="requestId" value={r.id} />
                <div className="grid gap-1.5">
                  <Label htmlFor={`note-${r.id}`}>Note (optional)</Label>
                  <Textarea id={`note-${r.id}`} name="note" maxLength={2000} rows={2} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" name="outcome" value="released">
                    I have released it
                  </Button>
                  <Button type="submit" name="outcome" value="declined" variant="outline">
                    I cannot release it
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ))}
    </Page>
  );
}
