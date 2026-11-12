import { createBrowserClient } from '@supabase/ssr';

/** Browser client for sign-in and MFA only. Sees just the Supabase URL and anon key. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
