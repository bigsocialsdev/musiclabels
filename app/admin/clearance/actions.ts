'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { escalateClearance, resendClearance, resolveClearance } from '@/lib/clearance/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';

const id = z.uuid();
const to = (params: Record<string, string>) => redirect(`/admin/clearance?${new URLSearchParams(params)}`);

export async function resendClearanceAction(requestId: string) {
  const admin = await requireAdminArea('clearance', '/admin/clearance');
  const r = await resendClearance(getDb(), admin, id.parse(requestId), clientIp(await headers()));
  to(r.ok ? { done: 'resent' } : { error: 'That request is no longer waiting for the seller' });
}

export async function escalateClearanceAction(requestId: string) {
  const admin = await requireAdminArea('clearance', '/admin/clearance');
  const r = await escalateClearance(getDb(), admin, id.parse(requestId), clientIp(await headers()));
  to(r.ok ? { done: 'escalated' } : { error: 'Only an overdue request can be escalated' });
}

export async function resolveClearanceAction(requestId: string, form: FormData) {
  const admin = await requireAdminArea('clearance', '/admin/clearance');
  const input = z.object({ outcome: z.enum(['released', 'declined']), note: z.string().trim().min(3).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) to({ error: 'Choose an outcome and write the evidence (at least a few words)' });
  const r = await resolveClearance(getDb(), admin, id.parse(requestId), input.data!, clientIp(await headers()));
  to(r.ok ? { done: input.data!.outcome } : { error: 'That request is already closed' });
}
