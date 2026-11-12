import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from './env';

let admin: SupabaseClient | undefined;

/** Service-role client: server-only, bypasses RLS. Used for Storage and Auth admin calls. */
export function getSupabaseAdmin(): SupabaseClient {
  const env = getEnv();
  return (admin ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }));
}
// Cookie-based SSR clients (browser/server) and proxy.ts session refresh arrive with S3-M1 (Auth).
