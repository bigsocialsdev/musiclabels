import type { Metadata } from 'next';
import { Page, PageHeader } from '@/app/seller/ui';
import { Table, Td, Th } from '@/app/seller/table';
import { istDateTime } from '@/components/store/format';
import { StatusLabel, type StatusTone } from '@/components/ui/status';
import { ALERT_LIST_LIMIT, listOpsAlerts } from '@/lib/notifications/server';
import { getDb } from '@/lib/platform/db';
import { requireAnyAdminArea } from '../guard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Alerts | MRM Admin', robots: { index: false } };

const EMAIL: Record<string, { tone: StatusTone; label: string }> = {
  pending: { tone: 'attention', label: 'Email waiting' },
  sending: { tone: 'attention', label: 'Email sending' },
  sent: { tone: 'ok', label: 'Emailed' },
  failed: { tone: 'blocked', label: 'Email failed' },
};

/** Everything the system has flagged for ops (PLAN §10), newest first. The email is the page; this list is the record, and shows when an email did not go out. */
export default async function AlertsPage() {
  const admin = await requireAnyAdminArea('/admin/alerts');
  const rows = await listOpsAlerts(getDb(), admin);

  return (
    <Page width="wide">
      <PageHeader title="Alerts">
        Problems the system flagged for ops: failed handlers, stuck payments, reconciliation differences, overdue clearance and disputes, backups. The latest {ALERT_LIST_LIMIT} are listed; each is also emailed to the ops address.
      </PageHeader>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No alerts raised.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Raised</Th>
              <Th>Alert</Th>
              <Th>Details</Th>
              <Th>Email</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const email = EMAIL[a.emailStatus] ?? { tone: 'muted' as const, label: a.emailStatus };
              return (
                <tr key={a.id} className="align-top">
                  <Td className="whitespace-nowrap text-fg-2">{istDateTime(a.createdAt)}</Td>
                  <Td>
                    <div className="font-semibold">{a.title}</div>
                    <div className="font-mono text-[12px] text-fg-2">{a.kind}</div>
                  </Td>
                  <Td className="max-w-md font-mono text-[12px] break-words whitespace-pre-wrap">{a.details}</Td>
                  <Td>
                    <StatusLabel tone={email.tone}>{email.label}</StatusLabel>
                    {a.lastError && <div className="mt-1 max-w-48 text-[12px] break-words text-muted-foreground">{a.lastError}</div>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Page>
  );
}
