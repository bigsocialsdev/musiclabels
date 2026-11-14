'use server';

import { redirect } from 'next/navigation';
import { endSession, loadSession, requireVerified } from '@/lib/identity/server';
import { completeSignIn } from './post-sign-in';

/** Called by the sign-in form right after Supabase confirms the OTP. */
export async function finishSignIn(next?: string) {
  const guard = requireVerified(await loadSession());
  if (!guard.ok) redirect('/auth/sign-in');
  redirect(await completeSignIn(guard.value, next));
}

export async function signOut() {
  await endSession();
  redirect('/');
}
