'use server';

import { redirect } from 'next/navigation';
import { ensureUser, loadSession, requireVerified, safeNext } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';

/** Called by the sign-in form right after Supabase confirms the OTP: creates the app user row, then continues. */
export async function finishSignIn(next?: string) {
  const guard = requireVerified(await loadSession());
  if (!guard.ok) redirect('/auth/sign-in');
  await ensureUser(getDb(), guard.value);
  redirect(safeNext(next));
}
