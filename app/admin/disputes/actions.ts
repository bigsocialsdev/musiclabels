'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { recordFirstAction, resolveDispute, setClaimantCataloged } from '@/lib/disputes/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';

const id = z.uuid();
const note = z.string().trim().min(1).max(2000);
const detail = (disputeId: string, params: Record<string, string>) => redirect(`/admin/disputes/${disputeId}?${new URLSearchParams(params)}`);

export async function firstActionAction(disputeId: string, form: FormData) {
  const admin = await requireAdminArea('disputes', `/admin/disputes/${disputeId}`);
  const input = z.object({ note }).safeParse(Object.fromEntries(form));
  if (!input.success) detail(disputeId, { error: 'Describe the action taken' });
  const r = await recordFirstAction(getDb(), admin, id.parse(disputeId), input.data!, clientIp(await headers()));
  detail(disputeId, r.ok ? { done: 'first_action' } : { error: 'This dispute is no longer open' });
}

export async function resolveDisputeAction(disputeId: string, form: FormData) {
  const admin = await requireAdminArea('disputes', `/admin/disputes/${disputeId}`);
  const input = z.object({ resolution: z.enum(['released', 'denied', 'kit_issued']), note }).safeParse(Object.fromEntries(form));
  if (!input.success) detail(disputeId, { error: 'Choose an outcome and write the note the buyer will see' });
  const r = await resolveDispute(getDb(), admin, id.parse(disputeId), input.data!, clientIp(await headers()));
  detail(disputeId, r.ok ? { done: 'resolved' } : { error: 'This dispute cannot take that outcome from its current status' });
}

export async function claimantCatalogedAction(disputeId: string, cataloged: boolean) {
  const admin = await requireAdminArea('disputes', `/admin/disputes/${disputeId}`);
  const r = await setClaimantCataloged(getDb(), admin, id.parse(disputeId), cataloged, clientIp(await headers()));
  detail(disputeId, r.ok ? { done: 'cataloged' } : { error: 'Dispute not found' });
}
