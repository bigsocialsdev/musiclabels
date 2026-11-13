'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requestDisputeRefund } from '@/lib/disputes/server';
import { executeRefund, productionDeps } from '@/lib/orders/server';
import { retryRefund } from '@/lib/payments/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { kick } from '@/lib/platform/tasks';
import { requireAdminArea } from '../guard';

const id = z.uuid();
const back: (params: Record<string, string>) => never = (params) => redirect(`/admin/refunds?${new URLSearchParams(params)}`);
const send = (refundId: string) => kick('refund', () => executeRefund(getDb(), refundId, productionDeps()));

/** Finance approves the refund for a refund-eligible dispute: the row is created (audited), then sent to Razorpay after the response. */
export async function approveDisputeRefundAction(disputeId: string) {
  const admin = await requireAdminArea('finance', '/admin/refunds');
  const r = await requestDisputeRefund(getDb(), admin, id.parse(disputeId));
  if (!r.ok) back({ error: 'refund_unavailable' });
  send(r.refundId);
  back({ done: 'approved' });
}

/** Re-sends a refund that failed or was never sent. The audit row names the admin; the claim is a compare-and-set, so a double click sends once. */
export async function retryRefundAction(refundId: string) {
  const admin = await requireAdminArea('finance', '/admin/refunds');
  const r = await retryRefund(getDb(), admin, id.parse(refundId), clientIp(await headers()));
  if (!r.ok) back({ error: 'refund_settled' });
  send(refundId);
  back({ done: 'retry' });
}
