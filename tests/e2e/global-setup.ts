import { startFakeAuth } from './fake-auth';

// One fake Auth server for the whole run (the desktop and mobile projects share it). If something already answers on
// the port, such as a real local Supabase, leave it alone: the signed-in specs then say they were redirected to sign-in.
export default async function globalSetup() {
  // The signed-in specs insert an admin user and read real rows: never point them at a shared or production database.
  const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : '';
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) throw new Error('e2e needs DATABASE_URL set to a local database');
  try {
    const server = await startFakeAuth();
    return () => void server.close();
  } catch (e) {
    console.warn(`fake Auth server not started: ${e instanceof Error ? e.message : e}`);
  }
}
