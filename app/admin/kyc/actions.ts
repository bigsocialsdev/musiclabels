'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { OnboardingError, setKycStatus } from '@/lib/sellers/server';
import { requireAdminArea } from '../guard';

const back: (params: Record<string, string>) => never = (params) => redirect(`/admin/kyc?${new URLSearchParams(params)}`);

export async function decideKycAction(orgId: string, outcome: 'verified' | 'rejected' | 'pending', data: FormData) {
  const admin = await requireAdminArea('verification', '/admin/kyc');
  const input = z.object({ note: z.string().trim().min(1).max(1000) }).safeParse(Object.fromEntries(data));
  if (!input.success) back({ error: 'need_note' });
  let r;
  try {
    r = await setKycStatus(getDb(), admin, z.uuid().parse(orgId), z.enum(['verified', 'rejected', 'pending']).parse(outcome), input.data.note, clientIp(await headers()));
  } catch (e) {
    if (e instanceof OnboardingError) back({ error: 'need_note' });
    throw e;
  }
  back(r.ok ? { done: outcome } : { error: r.reason });
}
