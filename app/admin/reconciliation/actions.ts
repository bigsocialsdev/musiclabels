'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { resolveReconciliationItem } from '@/lib/payments/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';

const to = (params: Record<string, string>) => redirect(`/admin/reconciliation?${new URLSearchParams(params)}`);

export async function resolveItemAction(itemId: string, form: FormData) {
  const admin = await requireAdminArea('finance', '/admin/reconciliation');
  const input = z.object({ note: z.string().trim().min(1).max(2000) }).safeParse(Object.fromEntries(form));
  if (!input.success || !z.uuid().safeParse(itemId).success) to({ error: 'no_note' });
  const r = await resolveReconciliationItem(getDb(), admin, itemId, input.data!.note, clientIp(await headers()));
  to(r.ok ? { done: 'resolved' } : { error: 'closed' });
}
