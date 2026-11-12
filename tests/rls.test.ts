import { afterAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/platform/db';

afterAll(closeDb);

it('every public table has RLS enabled and no anon/authenticated policy', async () => {
  const db = getDb();
  const noRls = await db.execute(sql`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
      AND c.relname NOT LIKE '\_\_drizzle%'`);
  expect(noRls.map((r) => r.relname)).toEqual([]);

  // CLAUDE.md: policies only where a browser genuinely reads through Supabase. None yet; extend this
  // allowlist deliberately when one is added.
  const policies = await db.execute(sql`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`);
  expect(policies.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([]);
});
