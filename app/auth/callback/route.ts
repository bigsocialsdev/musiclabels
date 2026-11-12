import { NextResponse } from 'next/server';
import { ensureUser, loadSession, requireVerified, safeNext } from '@/lib/identity/server';
import { getDb } from '@/lib/platform/db';
import { createSupabaseServerClient } from '@/lib/platform/supabase';

export const dynamic = 'force-dynamic';

/** OAuth (Google) return: exchange the code for a session, create the app user row, continue. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const guard = requireVerified(await loadSession());
      if (guard.ok) {
        await ensureUser(getDb(), guard.value);
        return NextResponse.redirect(new URL(next, url.origin));
      }
    }
  }
  return NextResponse.redirect(new URL('/auth/sign-in?error=1', url.origin));
}
