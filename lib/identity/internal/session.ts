import type { Session } from '../index';
import { createSupabaseServerClient } from '@/lib/platform/supabase';

/** Reads the session from request cookies. The user is validated against Supabase Auth, the AAL from the verified JWT. */
export async function loadSession(): Promise<Session | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { user } = data;
  const claims = await supabase.auth.getClaims();
  return {
    userId: user.id,
    email: user.email ?? null,
    phone: user.phone || null,
    verified: Boolean(user.email_confirmed_at || user.phone_confirmed_at),
    aal: claims.data?.claims.aal === 'aal2' ? 'aal2' : 'aal1',
  };
}

/** Revokes the session and clears its cookies. Call from a server action or route handler (cookies are writable there). */
export async function endSession(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
