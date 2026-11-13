'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { PermissionError } from '@/lib/identity/server';
import { resolveComplaint, startInvestigation } from '@/lib/disputes/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';

const id = z.uuid();
const to = (params: Record<string, string>) => redirect(`/admin/complaints?${new URLSearchParams(params)}`);

export async function investigateAction(complaintId: string) {
  const admin = await requireAdminArea('disputes', '/admin/complaints');
  const r = await startInvestigation(getDb(), admin, id.parse(complaintId), clientIp(await headers()));
  to(r.ok ? { done: 'investigating' } : { error: 'That complaint is no longer waiting' });
}

export async function resolveComplaintAction(complaintId: string, form: FormData) {
  const admin = await requireAdminArea('disputes', '/admin/complaints');
  const input = z.object({ outcome: z.enum(['upheld', 'rejected']), note: z.string().trim().min(1).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success) to({ error: 'Choose an outcome and write the note' });
  let r;
  try {
    r = await resolveComplaint(getDb(), admin, id.parse(complaintId), input.data!, clientIp(await headers()));
  } catch (e) {
    // Upholding a complaint that names a track also needs `verification`, because it suspends the track.
    if (e instanceof PermissionError) to({ error: 'Upholding a complaint about a track also needs the verification permission' });
    throw e;
  }
  to(r.ok ? { done: input.data!.outcome } : { error: 'That complaint cannot take that outcome from its current status' });
}
