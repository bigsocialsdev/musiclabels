'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { CatalogError, PRICE_LEVELS, approveTrack, getReviewDetail, rejectTrack } from '@/lib/catalog/server';
import { PermissionError } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';
import { clientIp } from '@/lib/platform/request';
import { recordClaimProbe } from '@/lib/screening/server';
import { requireVerificationAdmin } from './guard';

const back = (trackId: string, params: Record<string, string>) => `/admin/verification/${trackId}?${new URLSearchParams(params)}`;
const fail = (e: unknown) =>
  e instanceof CatalogError || e instanceof PermissionError || e instanceof z.ZodError ? e.message : 'Something went wrong';

const idSchema = z.uuid();

export async function approveAction(trackId: string, formData: FormData) {
  const admin = await requireVerificationAdmin(`/admin/verification/${trackId}`);
  const input = z
    .object({ clearanceClass: z.enum(['A', 'B']), priceLevel: z.enum(PRICE_LEVELS), overrideNote: z.string().max(2000).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!input.success) redirect(back(trackId, { error: 'Choose a class and a price level' }));
  let result;
  try {
    result = await approveTrack(getDb(), admin, { trackId: idSchema.parse(trackId), ...input.data }, clientIp(await headers()));
  } catch (e) {
    redirect(back(trackId, { error: fail(e) }));
  }
  if (!result.ok) redirect(back(trackId, { error: result.issues.join('; ') }));
  redirect('/admin/verification?done=approved');
}

export async function rejectAction(trackId: string, formData: FormData) {
  const admin = await requireVerificationAdmin(`/admin/verification/${trackId}`);
  const input = z.object({ reason: z.string().trim().min(1).max(2000), classC: z.string().optional() }).safeParse(Object.fromEntries(formData));
  if (!input.success) redirect(back(trackId, { error: 'A rejection reason is required' }));
  let result;
  try {
    result = await rejectTrack(getDb(), admin, { trackId: idSchema.parse(trackId), reason: input.data.reason, classC: input.data.classC === 'on' }, clientIp(await headers()));
  } catch (e) {
    redirect(back(trackId, { error: fail(e) }));
  }
  if (!result.ok) redirect(back(trackId, { error: 'This track is no longer in review' }));
  redirect('/admin/verification?done=rejected');
}

/** The probe always attaches to the track’s latest version (what review and approval look at), never to a client-named one. */
export async function probeAction(trackId: string, formData: FormData) {
  const admin = await requireVerificationAdmin(`/admin/verification/${trackId}`);
  const input = z
    .object({
      platform: z.enum(['youtube', 'meta']),
      claimant: z.string().trim().max(200).optional(),
      policy: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(2000).optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!input.success) redirect(back(trackId, { error: 'Invalid probe details' }));
  const { platform, claimant, policy, notes } = input.data;
  const detail = await getReviewDetail(getDb(), idSchema.parse(trackId));
  if (!detail?.version) redirect(back(trackId, { error: 'Track has no audio version' }));
  try {
    await recordClaimProbe(
      getDb(),
      admin,
      { versionId: detail.version.id, platform, claims: claimant ? [{ claimant, policy: policy ?? '' }] : [], notes: notes || null },
      clientIp(await headers()),
    );
  } catch (e) {
    redirect(back(trackId, { error: fail(e) }));
  }
  redirect(back(trackId, { probe: 'saved' }));
}
