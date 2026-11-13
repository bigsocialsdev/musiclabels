'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireBuyerSession } from '@/app/buyer-session';
import { OrgAccessError } from '@/lib/identity';
import { setVerifyFullName } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';

const input = z.object({ orgId: z.uuid(), show: z.enum(['on', 'off']) });

/** An individual buyer's choice to show their full name on the public verify page. Owner of the org only (checked in the slice). */
export async function verifyDisplayAction(form: FormData) {
  const p = input.safeParse({ orgId: form.get('orgId'), show: form.get('show') });
  if (!p.success) return;
  const session = await requireBuyerSession('/account');
  try {
    await setVerifyFullName(getDb(), { userId: session.userId, orgId: p.data.orgId }, p.data.show === 'on');
  } catch (e) {
    if (!(e instanceof OrgAccessError)) throw e;
  }
  revalidatePath('/account');
}
