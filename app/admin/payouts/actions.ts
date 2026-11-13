'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { productionDeps } from '@/lib/orders/server';
import { approvePayoutBatch, BankFileRail, computePayoutBatch, PayoutRefusal, payoutBankFileUrl, recordPayoutFailed, recordPayoutPaid, submitPayoutBatch } from '@/lib/payouts/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';

const id = z.uuid();
const period = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
const list: (params: Record<string, string>) => never = (params) => redirect(`/admin/payouts?${new URLSearchParams(params)}`);
const batch: (batchId: string, params: Record<string, string>) => never = (batchId, params) => redirect(`/admin/payouts/${batchId}?${new URLSearchParams(params)}`);

export async function computeBatchAction(form: FormData) {
  const admin = await requireAdminArea('finance', '/admin/payouts');
  const input = z.object({ period }).safeParse(Object.fromEntries(form));
  if (!input.success) list({ error: 'bad_period' });
  let created;
  try {
    created = await computePayoutBatch(getDb(), admin, input.data.period);
  } catch (e) {
    // Only the period-order refusals are the admin's to fix; anything else (a database error) surfaces as one.
    if (e instanceof PayoutRefusal) list({ error: 'compute_refused' });
    throw e;
  }
  batch(created.batch.id, { done: created.created ? 'computed' : 'exists' });
}

export async function approveBatchAction(batchId: string) {
  const admin = await requireAdminArea('finance', `/admin/payouts/${batchId}`);
  const ok = await approvePayoutBatch(getDb(), admin, id.parse(batchId));
  batch(batchId, ok ? { done: 'approved' } : { error: 'not_computed' });
}

export async function submitBatchAction(batchId: string) {
  const admin = await requireAdminArea('finance', `/admin/payouts/${batchId}`);
  let r;
  try {
    r = await submitPayoutBatch(getDb(), admin, id.parse(batchId), new BankFileRail(productionDeps().store));
  } catch (e) {
    // Only "not approved" is a refusal; a rail or storage failure after the batch moved to processing is a fault, and a rerun resumes it.
    if (e instanceof PayoutRefusal) batch(batchId, { error: 'not_approved' });
    throw e;
  }
  batch(batchId, { done: 'submitted', sent: String(r.submitted), held: String(r.held.length) });
}

/** Hands finance the bank file through a short-lived signed link; each download is audited. */
export async function downloadBankFileAction(batchId: string) {
  const admin = await requireAdminArea('finance', `/admin/payouts/${batchId}`);
  const url = await payoutBankFileUrl(getDb(), admin, id.parse(batchId), clientIp(await headers()));
  if (!url) batch(batchId, { error: 'no_file' });
  redirect(url);
}

export async function recordPaidAction(batchId: string, payoutId: string, form: FormData) {
  const admin = await requireAdminArea('finance', `/admin/payouts/${batchId}`);
  const input = z.object({ utr: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/) }).safeParse(Object.fromEntries(form));
  if (!input.success) batch(batchId, { error: 'bad_utr' });
  const r = await recordPayoutPaid(getDb(), admin, id.parse(payoutId), input.data.utr, productionDeps().store);
  batch(batchId, r.ok ? { done: 'paid' } : { error: 'not_processing' });
}

export async function recordFailedAction(batchId: string, payoutId: string, form: FormData) {
  const admin = await requireAdminArea('finance', `/admin/payouts/${batchId}`);
  const input = z.object({ reason: z.string().trim().min(1).max(500) }).safeParse(Object.fromEntries(form));
  if (!input.success) batch(batchId, { error: 'no_reason' });
  const r = await recordPayoutFailed(getDb(), admin, id.parse(payoutId), input.data.reason);
  batch(batchId, r.ok ? { done: 'failed' } : { error: 'not_processing' });
}
