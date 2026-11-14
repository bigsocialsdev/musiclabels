/**
 * The e2e specs and `seed:e2e` insert rows and read real ones. They must never run against a shared or production
 * database, so an unset or non-local `DATABASE_URL` stops them.
 */
export function assertLocalDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('e2e needs DATABASE_URL set to a local database');
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) throw new Error('e2e needs DATABASE_URL set to a local database');
}
