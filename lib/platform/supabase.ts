import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getEnv } from './env';

let admin: SupabaseClient | undefined;

/** Service-role client: server-only, bypasses RLS. Used for Storage and Auth admin calls. */
export function getSupabaseAdmin(): SupabaseClient {
  const env = getEnv();
  return (admin ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}

/** Per-request client bound to the caller's session cookies (anon key; RLS applies, which we never open). */
export async function createSupabaseServerClient() {
  const env = getEnv();
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component: cookies are read-only there; proxy.ts refreshes the session.
        }
      },
    },
  });
}
