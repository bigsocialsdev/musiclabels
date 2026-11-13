import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { listSellerClearance, type SellerClearanceRow } from '@/lib/clearance/server';
import { getDb } from '@/lib/platform/db';
import { FlashBanner } from '../flash';
import { fmtDate } from '../format';
import { requireSellerSession } from '../session';
import { respondClearanceAction } from './actions';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<SellerClearanceRow['status'], string> = {
  not_required: 'Not needed',
  pending: 'Waiting to be sent',
  sent: 'Waiting for you',
  overdue: 'Overdue',
  escalated: 'Escalated to our team',
  completed: 'Released',
  failed: 'Declined',
};

export default async function SellerClearancePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const { session, orgId } = await requireSellerSession('/seller/clearance');
  if (!orgId) redirect('/seller/onboarding');
  const rows = await listSellerClearance(getDb(), { userId: session.userId, orgId });
  const now = new Date();
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Clearance requests</h1>
      <p className="text-sm text-muted-foreground">
        When a buyer registers a channel or video for a track you have marked as possibly claimable elsewhere, we ask you to release any claim on it. Answering here is the same as using the link in the email. Releasing is your commitment; if you cannot release, say so and our team will help the buyer.
      </p>
      <FlashBanner token={m} />
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No clearance requests yet.</p>}
      {rows.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {r.trackTitle}
              <Badge variant={r.status === 'completed' ? 'default' : r.status === 'failed' || r.status === 'overdue' ? 'destructive' : 'outline'}>{STATUS_LABELS[r.status]}</Badge>
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
    </main>
  );
}
