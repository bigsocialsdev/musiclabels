'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { reinstateOrg, suspendOrg, SUSPENSION_REASON_MAX } from '@/lib/accounts/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { requireAdminArea } from '../guard';

const id = z.uuid();
const form = z.object({ reason: z.string().trim().min(1).max(SUSPENSION_REASON_MAX), confirm: z.literal('on') });
type Back = (params: Record<string, string>) => never;

export async function suspendOrgAction(orgId: string, data: FormData) {
  const admin = await requireAdminArea('superadmin', '/admin/accounts');
  const orgPage: Back = (params) => redirect(`/admin/accounts/org/${id.parse(orgId)}?${new URLSearchParams(params)}`);
  const input = form.safeParse(Object.fromEntries(data));
  if (!input.success) orgPage({ error: 'need_reason' });
  const r = await suspendOrg(getDb(), admin, { orgId: id.parse(orgId), reason: input.data.reason }, clientIp(await headers()));
  orgPage(r.ok ? { done: 'suspended', paused: String(r.pausedTracks) } : { error: r.reason });
}

export async function reinstateOrgAction(orgId: string, data: FormData) {
  const admin = await requireAdminArea('superadmin', '/admin/accounts');
  const orgPage: Back = (params) => redirect(`/admin/accounts/org/${id.parse(orgId)}?${new URLSearchParams(params)}`);
  const input = form.safeParse(Object.fromEntries(data));
  if (!input.success) orgPage({ error: 'need_reason' });
  const r = await reinstateOrg(getDb(), admin, { orgId: id.parse(orgId), reason: input.data.reason }, clientIp(await headers()));
  orgPage(r.ok ? { done: 'reinstated', resumed: String(r.resumedTracks) } : { error: r.reason });
}
