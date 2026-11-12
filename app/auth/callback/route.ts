import { NextResponse } from 'next/server';
import { loadSession, requireVerified } from '@/lib/identity/server';
import { createSupabaseServerClient } from '@/lib/platform/supabase';
import { completeSignIn } from '../post-sign-in';

export const dynamic = 'force-dynamic';

/** OAuth (Google) return: exchange the code for a session, then continue like any other sign-in. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const guard = requireVerified(await loadSession());
      if (guard.ok) {
        const path = await completeSignIn(guard.value, url.searchParams.get('next'));
        return NextResponse.redirect(new URL(path, url.origin));
      }
    }
  }
  return NextResponse.redirect(new URL('/auth/sign-in?error=1', url.origin));
}
