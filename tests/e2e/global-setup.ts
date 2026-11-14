import type { Server } from 'node:http';
import { startFakeRazorpay } from './fake-razorpay';
import { startFakeSupabase } from './fake-supabase';
import { assertLocalDatabase } from './local-db';

// One set of fakes for the whole run (the projects share them). A port that is already taken, such as by a real local
// Supabase, stops the run with a clear message instead of letting the specs fail in confusing ways.
export default async function globalSetup() {
  assertLocalDatabase();
  const started: Server[] = [];
  for (const [name, start] of [['Supabase', startFakeSupabase], ['Razorpay', startFakeRazorpay]] as const) {
    try {
      started.push(await start());
    } catch (e) {
      started.forEach((s) => s.close());
      throw new Error(`The fake ${name} server could not start (${e instanceof Error ? e.message : e}). Stop whatever uses that port, for example a local Supabase.`);
    }
  }
  return () => started.forEach((s) => s.close());
}
