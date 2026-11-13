'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requestDisputeRefund } from '@/lib/disputes/server';
import { executeRefund, productionDeps } from '@/lib/orders/server';
import { getDb } from '@/lib/platform/db';
import { kick } from '@/lib/platform/tasks';
import { requireAdminArea } from '../guard';

const id = z.uuid();
const back = (params: Record<string, string>) => redirect(`/admin/refunds?${new URLSearchParams(params)}`);
const send = (refundId: string) => kick('refund', () => executeRefund(getDb(), refundId, productionDeps()));

/** Finance approves the refund for a refund-eligible dispute: the row is created (audited), then sent to Razorpay after the response. */
export async function approveDisputeRefundAction(disputeId: string) {
  const admin = await requireAdminArea('finance', '/admin/refunds');
  const r = await requestDisputeRefund(getDb(), admin, id.parse(disputeId));
  if (!r.ok) back({ error: 'refund_unavailable' });
  else {
    send(r.refundId);
    back({ done: 'approved' });
  }
}

/** Re-sends a refund that failed or was never sent. The claim is a compare-and-set, so a double click sends once. */
export async function retryRefundAction(refundId: string) {
  await requireAdminArea('finance', '/admin/refunds');
  send(id.parse(refundId));
  back({ done: 'retry' });
}
