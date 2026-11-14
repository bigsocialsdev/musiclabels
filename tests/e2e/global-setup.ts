import type { Server } from 'node:http';
import { startFakeAuth } from './fake-auth';
import { startFakeRazorpay } from './fake-razorpay';

// One set of fakes for the whole run (the projects share them). If something already answers on a port, such as a real
// local Supabase, leave it alone: the specs that need the fake then say so (redirected to sign-in, payment failed).
export default async function globalSetup() {
  // The specs insert rows and read real ones: never point them at a shared or production database.
  const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : 'localhost';
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) throw new Error('e2e needs DATABASE_URL set to a local database');
  const started: Server[] = [];
  for (const [name, start] of [['Supabase', startFakeAuth], ['Razorpay', startFakeRazorpay]] as const) {
    try {
      started.push(await start());
    } catch (e) {
      console.warn(`fake ${name} not started: ${e instanceof Error ? e.message : e}`);
    }
  }
  return () => started.forEach((s) => s.close());
}
